## Context

Today's scheduling architecture is **user-driven**: humans (or Claude on behalf of admins) call `create_scheduled_message` to put rows into `data/state/cron-jobs.json`, and the scheduler tick in `src/cronScheduler.ts` reads those rows every 60s. Plugins can be *associated* with a job via the optional `plugin: string` field (used to derive `requiredTools` defaults), but they have no way to *own* a schedule declaratively.

The trivia plugin works around this with a setup wizard (`create_schedules_instructions`) that walks an admin through creating two cron jobs whose prompts are thin dispatchers: each one re-enters trivia at fire time via `send_questions_instructions` / `process_responses_instructions` to fetch the *substantive* prompt. The indirection exists because the admin authors the cron prompt but not the trivia behavior — so the cron prompt has to call back into trivia to get the real text.

Concurrently, the infrastructure for self-management is already mostly built:

- `lifecycle.ts:restartAll()` already does stop-schedulers → reload-config → reset-caches → `loadPlugins()` → restart-schedulers on demand.
- `configWatcher.ts` already watches `data/mcp.json`, `data/auth/.env`, and the `default_configuration/` + `configuration/` trees. It does **not** watch `data/config.json`.
- `CronJob.plugin: string` already exists as an informational field.
- `cronJobs.ts` already exposes a clean CRUD surface (`createJob`, `updateJob`, `deleteJob`, `getJobs`).

The gap is an SDK-facing API plus the Home-Tab affordance to make plugin-managed jobs visibly distinct from user-created ones.

## Goals / Non-Goals

**Goals:**

- Let a plugin declaratively describe the cron jobs it wants to exist, given a config block, and have them appear/disappear/update as that config changes.
- Survive an admin "pause" without bouncing back on next reconcile.
- Eliminate the round-trip-to-instructions-tool pattern: schedule prompts embed substantive instructions directly.
- Treat config edits as the operator interface — `data/config.json` is hot-watched, plugin reload triggers reconcile, no admin wizard.
- Make the Home Tab distinguish plugin-managed jobs from user-created ones so admins don't try to edit content that will be overwritten on next reconcile.

**Non-Goals:**

- General "scheduling abstraction for plugins" beyond cron jobs. The SDK exposes one method that maps to cron jobs as they exist today.
- Per-plugin scheduler tick. Plugin-managed jobs ride the same scheduler tick and concurrency guard as user-created jobs.
- Migrating user-created cron jobs that have nothing to do with trivia. Only legacy trivia jobs migrate; everything else stays untouched.
- Cross-plugin shared schedules (e.g. one cron triggers two plugins). Each plugin owns its own jobs via its `ownerKey`.
- Generalized `data/config.json` partial-reload. Any config change triggers the full `restartAll()` — same blast radius as the manual `/admin-restart` today.

## Decisions

### Decision 1: Declarative reconcile API, not imperative add/remove

`sdk.reconcileCronJobs(ownerKey, specs: CronJobSpec[])` is **declarative**: the plugin says "these are the N jobs I want to exist." The SDK computes the diff against `cron-jobs.json` rows where `plugin === ownerKey` and applies upserts + deletions.

**Why declarative over imperative?** Three reasons:
1. **Config-change handling is free.** Plugin init re-runs on every `restartAll()` → reconcile is idempotent → no separate "config diff" logic needed in the plugin.
2. **No leaked state.** A plugin can't accidentally orphan a job by forgetting to delete it; reconcile takes care of removing anything not in the new spec list.
3. **Mirror of common patterns** (Kubernetes-style declarative reconcile, Terraform). Easier to reason about than "imperative writes to shared state."

**Alternatives considered:**
- Per-spec `addCronJob` / `removeCronJob` methods. Rejected: requires plugins to track previous state themselves, which is exactly what the SDK should do.
- Returning specs from plugin init (instead of side-effecting through the SDK). Rejected: plugin init is async and may call other SDK methods between declarations; a single "return" point doesn't compose well.

### Decision 2: Stable per-spec identity via `ownerKey + specKey`

Each spec needs a stable identity so reconcile can update vs. recreate. The shape:

```ts
interface CronJobSpec {
  specKey: string;                // unique within ownerKey, e.g. "trivia:my-channel:question"
  cronExpression: string;
  channel: string;
  prompt: string;                 // already-interpolated, no thin dispatcher
  timezone: string;
  requiredTools?: string[];
  skipConditions?: string;
}
```

On reconcile: for each spec, find the existing job with matching `plugin === ownerKey && specKey === spec.specKey`. If found, update non-identity fields in place (preserving `id`, `runs[]`, `enabled`, `lastRunAt`, `lastRunStatus`). If not, create a new job. After the loop, delete any `plugin === ownerKey` job whose `specKey` is not in the new specs list.

**Why a separate `specKey` rather than reusing the existing `id` (UUID)?** The id is opaque and not derivable from config. The plugin would have to read existing jobs first to discover its own ids. `specKey` is a content-addressable key the plugin can compute purely from config (e.g. `${gameName}:question`), making reconcile trivially deterministic.

**Alternatives considered:**
- Use `(channel, cronExpression)` as the natural key. Rejected: brittle — changing the cron expression or channel via config edit would orphan + recreate the job, losing run history.
- Hash the spec. Rejected: same issue — any config edit invalidates the key.

### Decision 3: Preserve `enabled` across reconciles (admin override)

If a job already exists with `plugin === ownerKey && specKey === spec.specKey`, the reconcile **updates** the spec fields (prompt, cron, channel, etc.) but **does not touch** the `enabled` flag. The flag remains `true` by default at creation time; admins can flip it `false` from the Home Tab, and subsequent reconciles will not re-enable it.

**Why preserve it?** If an admin needs to pause a misbehaving plugin schedule, the only alternative would be removing the config entry — but that also deletes run history and forces the admin to remember to re-add it later. Preserving `enabled` makes the Home Tab's pause control honest.

**Alternative considered:** Make `enabled` part of the config spec. Rejected: introduces two sources of truth (config says enabled, admin says disabled) — confusing. Better to say config defines *desired existence*, admin defines *runtime gate*.

### Decision 4: `pluginManaged: boolean` field, distinct from `plugin: string`

We already have `plugin?: string` for "this user-created job is associated with plugin X." Now we add `pluginManaged?: boolean` meaning "this job was *created* by a plugin's `reconcileCronJobs` and should not be edited from the Home Tab."

**Why two fields?** They model different things:
- `plugin` = "for `requiredTools` defaulting, treat this as a trivia job"
- `pluginManaged` = "this row's content is owned by the reconcile loop; the Home Tab must not expose editing controls"

A user-created job could conceivably set `plugin` to opt into trivia's tool defaults without giving up ownership. Conflating the two would prevent that.

**Alternative considered:** Repurpose `plugin` to imply both. Rejected: more invasive and breaks the existing data shape.

### Decision 5: Embed substantive prompts at reconcile time, drop instruction tools

The three trivia instruction tools (`send_questions_instructions`, `process_responses_instructions`, `create_schedules_instructions`) become **plain functions** in the trivia plugin module. The reconciler calls them at reconcile time to build each spec's `prompt` directly.

**Why eliminate the tools entirely vs. keep them as a fallback?**
- They have no other use case. The only consumer was the thin-dispatcher cron prompt.
- Keeping them dual-purpose would make it ambiguous whether an old cron job still dispatching to them is "intentional" or "stale."
- The legacy migration converts old dispatcher-style jobs to config entries; once that runs, nothing calls the tools anymore.

**Risk:** the cron prompt is now ~3KB of embedded text per spec, persisted in `cron-jobs.json`. With N games × 2 schedules, the file grows linearly. For realistic N (≤10 games per deployment), this is negligible (~60KB). For very large N this would matter — out of scope.

### Decision 6: Watch `data/config.json` via the existing config watcher; trigger `restartAll`

Add a single watcher entry to `startConfigWatcher()` for `data/config.json`. The callback invokes the same lifecycle function as `/admin-restart` (or a new exported `triggerReload()` that does the same).

**Why piggyback on `restartAll` vs. a surgical partial-reload?** `restartAll` already correctly resets every cache touched by config changes. Building a partial-reload would mean enumerating every cache + scheduler dependency on the config — duplicative and easy to get wrong.

**Why unconditional vs. gated behind a flag?** The existing `claudeCode.watchMcpConfig` flag gates the *MCP config* watcher because reloading MCP servers mid-flight has side effects on in-flight tool calls. Watching `config.json` triggers a full `restartAll`, which already handles in-flight cleanup. No new risk.

**Risk:** an admin saving the config file repeatedly (e.g. mid-edit in an editor with autosave) could trigger multiple reloads. Mitigation: the existing `debounce(500ms)` in `configWatcher.ts` handles this.

### Decision 7: `sdk.watchFile(relativePath, callback)` is plugin-scoped, with an unwatch handle

Mirrors `sdk.readFile` / `sdk.writeFile`: paths are resolved under `data/plugins/<pluginName>/`. The factory tracks all returned `FSWatcher` instances and closes them when the plugin is reloaded (during `restartAll`).

```ts
sdk.watchFile("categories.json", () => {
  /* re-derive in-memory state */
}); // returns FSWatcher; tracked for teardown
```

**Why scope it to the plugin data dir?** Aligns with the existing read/write scoping (anti-traversal); plugins shouldn't reach into each other's state or into `data/state/`.

**Risk:** `fs.watch` on Linux ignores `{ recursive: true }`. The SDK only watches single files, not trees — keeps it portable. Plugins that need to watch a directory can compose multiple `watchFile` calls or write their own helper from `fs.watch`.

**Open question (deferred):** Should `watchFile` also expose `data/config.json` to plugins as a special case? **No for v1** — `config.json` changes already trigger `restartAll` which re-runs plugin init, so plugins observe config changes by re-reading config at init time. If a future use case justifies the plugin watching config independently of restart, we can add it then.

### Decision 8: Home Tab — split into two subsections with different control sets

The Home Tab renders two sections under the Scheduled Messages umbrella:

1. **"Scheduled Messages"** — entries where `!pluginManaged`. Existing controls: Enable/Disable, Delete, Edit (modal with skipConditions). Visibility rules unchanged (admin sees all, non-admin sees own).
2. **"Plugin Scheduled Messages"** — entries where `pluginManaged === true`. Read-only details (channel, schedule, plugin name, last run status). Single control: Enable/Disable (the admin-override). **No** Edit (content is config-driven), **no** Delete (removed via config edit).

Visibility: this section is **admin-only** (matches the "trivia setup is admin" gate). Non-admins do not see plugin-managed jobs in any form.

**Why hide Edit/Delete instead of disabling them with a tooltip?** The buttons aren't disabled; they don't exist. Reduces visual noise and avoids the "why can't I click this?" interaction. The empty state surfaces "Edit `config.trivia.games` to manage these" as a hint.

### Decision 9: Legacy migration is blocking, not enhancement

The migration that converts pre-existing trivia cron jobs into `config.trivia.games[]` runs as a **blocking** migration (before the bot starts accepting messages), not an enhancement. Reasons:

- The legacy jobs reference instruction tools that are being deleted. If the bot starts before the migration runs, those jobs would fire with a non-existent tool name.
- The migration is deterministic and doesn't need Claude (it just converts cron expressions + channels into `games[]` entries).

If migration fails for a specific job (e.g. cron expression couldn't be parsed, or the job's prompt doesn't match the known dispatcher pattern), it is **left in place** and a warning is logged. The admin can investigate and either fix it or delete it manually. The migration doesn't abort the boot.

## Risks / Trade-offs

- **Risk:** A typo in `config.trivia.games[]` (wrong channel ID, malformed cron) causes the reconcile to create a bad job that fires errors every interval. → **Mitigation:** The reconciler validates each spec before applying — invalid specs are skipped with a logged warning; the *valid* portion still reconciles. Validation includes cron-expression parsing (via `cron-parser`, same library as the scheduler) and a basic channel-ID shape check.

- **Risk:** Admin disables a plugin-managed job via the Home Tab, then the plugin's config entry is removed. The reconciler would delete the (disabled) job, including the admin's "I want this paused" state — but since the config entry is gone, this is correct behavior. → **Acceptable**, but document it: removing a config entry deletes the job unconditionally.

- **Risk:** The embedded prompt in `cron-jobs.json` drifts from the trivia source code (e.g. the plugin's prompt-building function is updated but existing jobs still have old prompts). → **Mitigation:** Reconcile runs on every plugin init (boot + every `restartAll`); since reconcile updates the `prompt` field in-place, embedded prompts refresh on the next reload. No drift in practice.

- **Risk:** Two plugins both want to reconcile jobs with the same `specKey`. → **Mitigation:** Not possible — reconcile filters by `plugin === ownerKey`. `specKey` is only required to be unique within an owner.

- **Trade-off:** Plugin-managed jobs lose the per-job Edit modal. Admins who want to override `skipConditions` on a plugin-managed job have to do it via config — which doesn't expose `skipConditions` yet. → **Out of scope for v1**: plugin-managed jobs do not support per-job `skipConditions` overrides; the plugin author decides the value when constructing the spec. If needed later, we can add an admin-override map in `data/state/`.

- **Trade-off:** `restartAll` on every `config.json` save is a coarse-grained reload (drops all caches, restarts schedulers). For an admin editing trivia times this is overkill — but consistent with the existing `/admin-restart` semantics, and avoids partial-reload complexity. → **Acceptable.**

## Migration Plan

1. **Add SDK methods + types** without using them — `reconcileCronJobs` is a no-op-equivalent if no plugin calls it; `watchFile` is unused.
2. **Add `pluginManaged` field** to `CronJob` (optional, defaults absent). All existing jobs load unchanged.
3. **Add `data/config.json` watcher** to `configWatcher.ts`. Existing deployments behave identically until they edit `config.json`.
4. **Add `config.trivia.games` schema** (optional, defaults absent). Existing trivia deployments with no `games` entry behave as today.
5. **Add trivia's reconcile call.** Skipped when `config.trivia.games` is empty/absent.
6. **Ship the legacy migration.** Runs at boot. Converts dispatcher-style trivia cron jobs into `config.trivia.games[]` entries, then deletes the converted jobs from `cron-jobs.json`. The next reconcile re-creates them with embedded prompts.
7. **Remove the three trivia instruction tools** (`send_questions_instructions`, `process_responses_instructions`, `create_schedules_instructions`). The functions backing them become internal prompt builders, called by reconcile.
8. **Update Home Tab rendering** to split into two subsections.
9. **Update default-configuration instruction files** that reference the removed tool names.

**Rollback:** The legacy migration is **destructive** for legacy cron jobs (it deletes them after conversion). Rollback requires either:
- Restoring `cron-jobs.json` from backup and re-deploying a prior bot version, or
- Manually re-creating cron jobs from the `games[]` config.

Operators should snapshot `data/state/cron-jobs.json` before the upgrade. The migration logs every converted job's id + content for forensic recovery.

## Open Questions

- **Default `name` field on `TriviaGame`.** Required or optional? Leaning required (humans need to refer to it; also used as part of `specKey`). Decided: required.
- **Behavior when a plugin-managed job's channel is no longer accessible** (bot removed from channel). Same as today's user-created jobs: errors at fire time, DM to creator. For plugin-managed jobs, there is no "creator" — DM the owner instead. → To codify in specs.
- **Multiple `ownerKey` per plugin.** Could a plugin reconcile two separate spec groups (e.g. one keyed `trivia-games`, another `trivia-reminders`)? The SDK accepts any string `ownerKey`, so yes — but should the SDK enforce that `ownerKey === pluginName`? Leaning: allow any string but document that prefixing with the plugin name is convention. Final call deferred to implementation.
