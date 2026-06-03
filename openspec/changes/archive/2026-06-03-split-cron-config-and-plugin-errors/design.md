## Context

Today `config.allowScheduledMessages` is a single boolean (default `false`) that controls three things at once:

1. **`src/lifecycle.ts:147`** — whether `startCronScheduler(client)` is called at boot. Without this call, the 60-second tick loop never starts and **no cron job fires**, regardless of who created it.
2. **`src/tools/server.ts:433`** — whether Claude is given the user-facing MCP tools to create/cancel/list scheduled messages and reminders.
3. **`src/claude/index.ts:227`** — the flag is threaded into the tool context for downstream gating decisions.

Meanwhile, `sdk.reconcileCronJobs` (`src/plugins/sdk.ts:554`) does **not** check this flag. The trivia plugin calls it unconditionally at init (`src/plugins/trivia/index.ts:184`), so plugin jobs get persisted to `data/state/cron-jobs.json` regardless — they simply never tick if the scheduler isn't running.

Result: an admin running the trivia plugin with the default config sees no questions, no reveals, and no error. The persisted jobs sit on disk as evidence that the plugin "worked," and the registry's silent catch (`src/plugins/registry.ts:126-128`) ensures any plugin that *does* throw at init is invisible to the admin too.

This change splits the flag, surfaces plugin failures, and gives plugins a structured way to refuse to load.

## Goals / Non-Goals

**Goals:**

- One config flag controls the scheduler tick loop (`cron.enabled`); another, narrower flag controls user-facing scheduling MCP tools (`cron.userSchedules`).
- Plugins can read a capability bit (`sdk.capabilities.crons`) and gracefully bow out when their prerequisites aren't met.
- Plugin load failures (intentional via `sdk.error` or thrown unexpectedly) are visible to admins in the Home Tab's existing `Status > Plugins` section.
- Existing deployments migrate automatically — no manual config edits required.
- Trivia self-disables (with a clear reason) instead of silently storing dead cron jobs.

**Non-Goals:**

- A general "feature flag" or "capabilities matrix" system. We add a single `capabilities.crons` bit; further capabilities are added on demand, not upfront.
- Making `sdk.error` fatal. It accumulates errors; plugins decide whether to also `return` early.
- Reworking the cron storage format. Plugin and user jobs continue to share `data/state/cron-jobs.json`; the `createdBy` field already distinguishes them.
- Migrating existing dead trivia jobs out of `cron-jobs.json`. They'll start firing again under the new defaults — that's the fix.
- Changing the user-facing MCP tool surface. The tools themselves don't change; only their gating moves.

## Decisions

### 1. Namespace as `config.cron`, not `config.scheduledMessages`

**Decision:** All cron-related config moves under `config.cron`.

**Alternatives considered:**
- Keep flat top-level fields (`config.cronEnabled`, `config.allowScheduledMessages`). Rejected — flat sprawl makes it hard to see related config together, and the count grows (`cron.maxRunHistory` is the third field already).
- `config.scheduledMessages` namespace. Rejected — "scheduled messages" is the user-facing feature; the broader concept (which now spans plugin crons too) is "cron."

**Why this wins:** keeps related config visually grouped, and the name matches what the underlying scheduler module is called (`cronScheduler.ts`, `cronJobs.ts`).

### 2. `cron.enabled` defaults to `true`; `cron.userSchedules` defaults to `false`

**Decision:** The scheduler runs by default. The user-facing tools remain opt-in.

**Rationale:** Plugin crons (trivia) are the common case — defaulting to off is what caused the silent-failure trap. User-facing scheduling tools are higher-trust (Claude can post into channels on a schedule) and should remain opt-in for safety.

**Behavior change risk:** any existing deployment with the default `allowScheduledMessages: false` and trivia configured will start firing those crons after upgrade. This is the intended fix; the alternative (default `cron.enabled: false`) would preserve the silent failure. Deployers who genuinely don't want crons must set `cron.enabled: false` explicitly — and they'll see the trivia plugin self-disable with a clear reason.

### 3. Invalid combo (`cron.enabled=false + userSchedules=true`) → warn + coerce, don't throw

**Decision:** At config load, if `cron.enabled === false && cron.userSchedules === true`, log a warning and treat `userSchedules` as `false`. Don't refuse to boot.

**Alternatives considered:**
- Throw and refuse to start. Rejected — too aggressive for a misconfigured edge case; admins lose access to the bot until they fix the config.
- Silently coerce without warning. Rejected — the user's intent was unclear; a log line is the minimum.

### 4. Plugin job execution is governed by `cron.enabled`; user job execution is governed by `cron.userSchedules` (at tick time)

**Decision:** The tick loop runs whenever `cron.enabled === true`. Inside the loop, before executing a job, the scheduler skips any job with `createdBy != null` if `cron.userSchedules === false`.

**Alternatives considered:**
- Maintain two separate scheduler instances. Rejected — pointless complexity; one tick loop with a filter is fine.
- Delete user-created jobs from disk when the flag flips off. Rejected — destructive and reversible-only by re-creating; the filter is a soft gate that respects user data.

**Side effect for Home Tab:** the same flag (`cron.userSchedules`) drives the visibility of the user-schedules section, so admin UI stays consistent with runtime behavior.

### 5. `sdk.error(reason: string): void` — multi-shot, non-fatal

**Decision:** Plugins accumulate errors via repeated calls to `sdk.error(reason)`. Each call appends to a per-plugin `errors[]` array. The plugin function controls its own continuation (call `return` to bail early, or keep running for partial functionality).

**Alternatives considered:**
- `sdk.fail(reason): never` (one-shot, throws internally). Rejected — forces the plugin to choose one error per load. A future plugin with several independent prerequisites (e.g. "I need crons AND I need the GitHub MCP") would want to report all of them at once.
- Throw a typed `PluginDisabledError`. Rejected — using throw forces the catch path and complicates the "report two problems and continue partial" case.
- Return a value (`{ disabled: true, reason }`). Rejected — changes every plugin's signature; too invasive for the benefit.

### 6. `sdk.capabilities.crons` (flat boolean), not nested namespace or method

**Decision:** A flat `capabilities` object on the SDK with boolean fields. The first field is `crons`.

**Alternatives considered:**
- `sdk.cron.isEnabled()` method. Rejected — implies an active check; capabilities are static-at-load-time facts that don't change during plugin init.
- Make `reconcileCronJobs` throw when crons are disabled. Rejected — couples the gate to one specific use case; a plugin that depends on crons for a *different* reason (e.g. internal scheduling without user-visible jobs) would have nothing to check.

**Why flat:** keeps the surface small and the lookup obvious. Future capabilities (`capabilities.github`, `capabilities.slack`, etc.) live alongside.

### 7. Plugin registry pushes a synthetic result for caught throws

**Decision:** When the registry's `try` block catches an unexpected throw, it pushes a `PluginLoadResult` with `errors: [String(err.message ?? err)]` and no instructions/tools/cron-handlers. The plugin is "present but degraded" rather than absent.

**Rationale:** The Home Tab queries `loadedPlugins.results`. Making the failing plugin present-with-errors means the same UI path renders both the intentional `sdk.error` case and the unexpected throw — one rendering rule covers both.

### 8. Per-plugin error banner, not a global one

**Decision:** In the Home Tab `Status > Plugins` section, render the error banner directly beneath each plugin row that has `errors.length > 0`. No top-level banner, no separate "errors" section.

**Rationale:** The error is *about* that plugin; co-locating keeps the cause obvious. Admins scanning the section see at a glance which plugins are healthy and which aren't, without bouncing between sections.

### 9. Boot migration, not lazy config-read coercion

**Decision:** A new `src/migrations/NNN-cron-config-namespace.ts` boot migration rewrites `allowScheduledMessages` → `cron.userSchedules` and `scheduledMessagesMaxRunHistory` → `cron.maxRunHistory` in `data/config.json` on first boot. The old fields are deleted from the file.

**Alternatives considered:**
- Read both old and new fields forever, with new taking precedence. Rejected — keeps the legacy shape alive indefinitely; future maintainers have to remember two names.
- Migrate inside the config validator. Rejected — config is loaded many times; the rewrite should happen once with a logged trace, which the boot migration framework provides.

## Risks / Trade-offs

- **[Trivia jobs start firing for existing deployments after upgrade.]** → Migration logs note the rename; release notes call out the behavior change. Admins who want no crons can opt out via `cron.enabled: false`, and trivia will then disable itself with a clear reason. Net: this is the intended fix, but communicate it loudly.
- **[Plugins that throw at init now appear in the Home Tab even on slow networks or transient errors.]** → Acceptable. An admin sees a noisy banner for one boot cycle; restarting clears it if the underlying cause was transient. Better than silent invisibility.
- **[`sdk.error` is multi-shot and non-fatal — a plugin author could call it and then continue registering broken tools.]** → The plugin chooses whether to `return`; this is intentional flexibility. Document the convention: "call `sdk.error` for any unmet prerequisite, then `return` if the plugin is non-functional without it." Code review covers the rest.
- **[User jobs that were created when `userSchedules` was on, then orphaned when the flag flips off, still consume disk and `runs[]` quota.]** → Acceptable. They don't tick (filter at runtime), don't churn execution history, and remain available if the admin re-enables the flag. A future cleanup tool can reap them if needed; not in scope here.
- **[Existing tests reference `allowScheduledMessages` in fixtures.]** → Mechanical update; touched files are listed in `tasks.md`. The boot migration covers production data; tests update directly to the new shape.

## Migration Plan

**Code-path order:**
1. Land the `Config` type changes and validation. Keep the legacy field readable for one release for safety (config validator accepts the old key, logs a deprecation warning, populates `cron.userSchedules`/`cron.maxRunHistory`). The boot migration rewrites the persisted file separately.
2. Wire the new gates (`lifecycle.ts`, `cronScheduler.ts` tick filter, `tools/server.ts`, `homeTab.ts`).
3. Add `sdk.capabilities.crons` and `sdk.error`; update `PluginLoadResult`, registry catch path, and plugin state exposure.
4. Update `trivia/index.ts` to self-check.
5. Write the boot migration. Cover both fields. Use the existing migration framework; reference `/create-migration` for the scaffolding.
6. Update existing tests for the new config shape; add new tests for the user-job filter, the invalid-combo coercion, the trivia self-check, and the registry error-capture path.

**Rollback:** revert the commit. The boot migration writes the new keys but leaves no data we can't reconstruct from the legacy keys; old code reading the persisted (already-rewritten) `data/config.json` will see `allowScheduledMessages` as absent and treat it as `false`, which matches the prior default behavior. Trivia jobs that started firing after the migration will continue to be persisted but won't tick (because the scheduler isn't started without the flag). Slight behavioral oddity, but no data loss.

**No new dependencies, no schema changes to `cron-jobs.json`, no Slack manifest changes.**

## Open Questions

_None._ All decisions resolved during the exploration phase prior to writing this proposal.
