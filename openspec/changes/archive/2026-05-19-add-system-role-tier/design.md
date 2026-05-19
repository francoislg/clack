## Context

The Clack plugin SDK exposes `sdk.reconcileCronJobs(ownerKey, specs)` so plugins can declaratively own a set of scheduled jobs (today: the trivia plugin's per-game question/reveal pair). Inside `src/plugins/sdk.ts`, every reconciled job is persisted with `createdBy: pluginName` — i.e. the literal string `"trivia"`. That string is then consumed everywhere a `CronJob.createdBy` is treated as a Slack userId:

- `cronScheduler.executeDynamicJob` → `processMessage({ userId: job.createdBy, ... })`
- `changeWorkflowHelper.getClaudeOptions(userId, ...)` → `getRole(userId)` → resolves to `"member"` because `"trivia"` is not in `roles.json`
- `notifyCreatorOfError` → `openDmChannel(client, job.createdBy)` → silently fails
- Home Tab cron list → `slackLink(createdBy)` → renders `@trivia` as if it were a user
- Session attribution → the persisted session lists `userId: "trivia"`, so it appears in `find_sessions` results as user-owned activity

The immediate symptom is the role-gating catch-22: trivia tools registered with `minRole: "owner"` (e.g. `get_ideas`, `save_question`, `submit_answers`) are filtered out for `"member"`, but the same names appear in the cron job's `requiredTools` list, so `submit_response` cannot satisfy the gate and the run cannot complete. The other four leaks are latent — they don't crash today because the bad paths rarely fire, but they will bite the next time a plugin cron job fails.

The recently-introduced `pluginManaged: true` field on `CronJob` already marks these rows. What's missing is a typed identity that the rest of the system can branch on, and a role tier that represents "the bot acting on its own behalf, not impersonating any user."

## Goals / Non-Goals

**Goals:**
- Resolve the catch-22 by introducing a `"system"` role tier that plugin-managed cron jobs run as.
- Stop overloading `CronJob.createdBy` with a plugin name. Plugin-managed jobs persist `createdBy: null` and carry a structured `systemActor: "plugin:<name>"` field instead.
- Centralize actor-identity handling behind a small typed `Actor` API and a handful of utilities so call sites stop reaching for `job.createdBy` directly.
- Route plugin-managed job error notifications to the deployment owner (via the existing `sdk.dmOwner` plumbing) instead of attempting to DM a non-user.
- Keep the existing `meetsMinimumRole` ordering as the canonical role-check API. Force literal `role === "owner"` checks (used for ownership transfer / role mutation) to correctly exclude `"system"`.
- Migrate existing plugin-managed rows in `cron-jobs.json` in place via a blocking boot migration.

**Non-Goals:**
- A general "actor" plumbing for non-cron system entry points (boot migrations, worktree monitor, etc.). Their entry points don't go through `processMessage`, so they don't hit the role gate. The `Actor` type is designed to extend to them later — `systemActor` already takes a free-form source string — but this change scopes the wiring to cron only.
- Changing the plugin SDK signature. `sdk.reconcileCronJobs(ownerKey, specs)` stays the same; the actor rewrite is server-side.
- Changing role assignment UX. The Home Tab continues to expose only `"admin" | "dev" | "member"` as assignable, with `"owner"` handled via transfer-ownership. `"system"` never appears in the UI.
- Allowing plugins to declare arbitrary `runAsRole` values. Plugin-managed jobs always run as `"system"`; user-created jobs always run as `getRole(createdBy)`. There is no middle ground.

## Decisions

### Decision 1: `"system"` is a new role tier, not a synonym for `"owner"`

**Choice:** Add `"system"` to the `UserRole` union at the top of `ROLE_HIERARCHY`. `meetsMinimumRole("system", X)` returns `true` for every `X`. Literal `role === "owner"` checks return `false` for `"system"` (since the strings differ).

**Alternatives considered:**
- *Tie `"system"` with `"owner"` (same string).* Loses the audit distinction and forces all `role === "owner"` literal checks to either accept system bypass (often wrong) or special-case it (defeats the simplicity gain).
- *Treat plugin crons as the actual deployment owner (resolve `roles.owner` at reconcile time).* Couples plugin-job history attribution to whoever holds ownership at the moment; ownership transfers retroactively re-attribute the past. Also silently grants plugins ownership-transfer powers under literal `=== "owner"` checks.
- *Add a `runAsRole` field on `CronJob` without a new tier.* Smallest diff, but doesn't fix the userId leak (errors still DM `"trivia"`, sessions still show user `"trivia"`).

**Why this one:** A new tier captures intent (this is bot-as-itself, not impersonation), the hierarchy-vs-literal split surgically excludes system from ownership-mutating paths, and the existing `meetsMinimumRole` callers automatically benefit without code change.

### Decision 2: `createdBy` becomes nullable; `systemActor` carries the structured origin

**Choice:** Change `CronJob.createdBy` from `string` to `string | null`. Plugin-managed jobs persist `createdBy: null` and `systemActor: "plugin:<ownerKey>"`. User-created jobs are unchanged (always a non-null Slack userId, never a `systemActor`).

**Alternatives considered:**
- *Keep `createdBy: string`, use a sentinel like `"__system__"`.* Sentinel values are landmines — every consumer must remember to check the sentinel before treating it as a userId. Nullability surfaces the obligation at the type-checker level.
- *Drop `createdBy` for system jobs entirely and rely on `pluginManaged === true`.* The boolean is too narrow — it can't distinguish a future non-plugin system actor (boot migration, monitor sweep). `systemActor` as a free-form source string scales.

**Why this one:** Nullability is enforced by TypeScript, so call sites that previously did `slackLink(createdBy)` or `getRole(createdBy)` now break at compile time and force a refactor to actor-aware helpers. `systemActor` is opt-in additional structure for system jobs without polluting the user-job shape.

### Decision 3: Centralize identity behind an `Actor` type + utilities

**Choice:** Create `src/actor.ts` exporting:

```ts
export type Actor =
  | { kind: "user"; userId: string; role: UserRole }
  | { kind: "system"; source: string };

export async function resolveJobActor(job: CronJob): Promise<Actor>;
export function actorRole(actor: Actor): UserRole;          // "system" or user's role
export function actorDmTarget(actor: Actor): string | null; // null for system jobs
export function actorDisplay(actor: Actor): string;         // "@U123" or "System (plugin: trivia)"
```

`cronScheduler`, `notifyCreatorOfError`, Home Tab cron rendering, and any session-attribution code consume actors through these helpers — never via `job.createdBy` directly.

**Alternatives considered:**
- *Sprinkle `if (job.pluginManaged) role = "system"; else role = await getRole(job.createdBy)` at each call site.* Three call sites today, easy to forget the fourth later. Single source of truth in `actor.ts` keeps drift at zero.
- *Make `resolveJobActor` cache its role lookup.* Adds state; the existing `getRole` cache (in `roles.ts`) already handles the hot path.

**Why this one:** Utility-driven enforcement matches the user's stated preference ("create utilities to properly handle those"). Adding a new system source (e.g. `"boot-migration"`) later requires only extending `resolveJobActor`'s branching, not finding every consumer.

### Decision 4: Error DMs for system jobs route to the deployment owner

**Choice:** When `actorDmTarget(actor) === null` (i.e. system actor), the cron scheduler calls `sdk.dmOwner(text)` to escalate the failure to the deployment owner. The DM text identifies the job by `systemActor` source ("a `plugin:trivia` cron job failed: …") so the owner can locate it without a user mention.

**Alternatives considered:**
- *Drop the DM entirely; log only.* Current behavior, but only by accident (the DM open silently fails). Plugin-managed cron failures are a real deployment-health concern.
- *DM all admins.* Noisier; ownership is the canonical escalation path.
- *DM the user who last touched the plugin config.* Not tracked, and ownership transfers would break it.

**Why this one:** Plugin-managed crons are infrastructure the owner authorized via `data/config.json`. Owner-routed escalation matches that mental model, and the plumbing (`sdk.dmOwner`) already exists.

### Decision 5: Boot migration rewrites legacy rows

**Choice:** Add a blocking migration `src/migrations/0XX-system-actor-on-plugin-crons.ts` that reads `data/state/cron-jobs.json`, finds rows where `pluginManaged === true && typeof createdBy === "string"`, and rewrites them as `createdBy: null, systemActor: "plugin:${plugin}"` (using the existing `plugin` field as the source). User-created jobs are untouched.

**Alternatives considered:**
- *Handle the legacy shape lazily at load time.* Mixes the legacy and new shapes in memory — every consumer would need to handle both. A one-shot migration normalizes the data and the in-code branch is unnecessary forever after.
- *Make it an "enhancement" migration.* Blocking is the right priority — the old shape causes the catch-22, and we want it fixed before the first cron tick after deploy.

**Why this one:** Numbered blocking migrations are the project's idiomatic upgrade path. `/create-migration` will be used to scaffold the file (per `CLAUDE.md`).

## Risks / Trade-offs

- **[Risk]** A future literal `role === "owner"` check is added that *should* allow system but doesn't. → **Mitigation:** Add a one-paragraph note to the `user-roles` spec explaining the hierarchy-vs-literal split; add a lint-style unit test that enumerates every literal `=== "owner"` in `src/` and confirms each is in the ownership-mutation allowlist (transfer, claim, role assignment) where system exclusion is correct.
- **[Risk]** The boot migration touches every plugin-managed job in `cron-jobs.json`. A misformed legacy row (e.g. `pluginManaged: true` but missing `plugin`) could be silently rewritten to `systemActor: "plugin:undefined"`. → **Mitigation:** Migration validates `typeof plugin === "string" && plugin.length > 0` before rewriting; rows that fail are logged and left alone (subsequent tick will surface them via the existing invalid-spec warning).
- **[Risk]** Plugin authors who reach into `cron-jobs.json` (or write tests asserting `createdBy === pluginName`) will break. → **Mitigation:** This is the *intended* breakage — the new contract is enforceable via TypeScript, and existing internal tests are part of this change's task list.
- **[Trade-off]** The `Actor` abstraction adds a small indirection: `cronScheduler.executeDynamicJob` now does `await resolveJobActor(job)` before calling `processMessage`. The lookup is cached (via `roles.ts`'s in-memory `cachedRoles`) so cost is negligible.
- **[Trade-off]** `"system"` only escalates DMs to one human (the owner). If the owner is unreachable or has notifications muted, plugin-cron failures may go unnoticed longer than they would with a fan-out DM. Acceptable — the existing user-created-cron error path has the same single-DM behavior.

## Migration Plan

1. Land the role-tier and actor utilities (additive, no behavior change yet).
2. Land the data-model nullability (`CronJob.createdBy: string | null`) plus the boot migration. After this lands, all existing rows are normalized.
3. Switch `sdk.reconcileCronJobs` to emit the new shape. Subsequent reconciles produce normalized rows.
4. Switch the cron scheduler to resolve roles via the actor utilities and route error DMs accordingly.
5. Switch Home Tab cron rendering and any `slackLink(createdBy)` callers to actor-aware helpers.

Rollback: revert is safe if step 2 hasn't run in production (the migration is the only persistent mutation). If a revert is needed after step 2, the legacy shape can be reconstructed from `systemActor` (split on `:` → plugin name) via an emergency one-off script; this is documented but not pre-shipped.

## Open Questions

- Should the migration also emit a one-line log per rewritten row? Recommendation: yes, at `info` level, so the audit trail is visible on the deploy that introduces the change. Cheap to remove if noisy.
