## Why

A single `config.allowScheduledMessages` flag (default `false`) currently gates two unrelated concerns: (a) whether the cron tick loop runs at all, and (b) whether Claude exposes user-facing scheduling tools (`create_scheduled_message`, reminders, etc.). The conflation means plugin-registered cron jobs (e.g. trivia's reveal/question schedules) get persisted to `data/state/cron-jobs.json` but never fire when an admin leaves the flag at its default — a silent, undetectable failure. Compounding this, when any plugin fails to initialize, the registry catches the error and logs it but the failure is invisible in the Home Tab, so an admin running trivia with `allowScheduledMessages: false` sees neither cron output nor any indication that trivia opted out.

## What Changes

- **BREAKING** Introduce `config.cron` namespace:
  - `config.cron.enabled` (default `true`) — gates the cron scheduler tick loop and all plugin cron execution.
  - `config.cron.userSchedules` (default `false`) — gates the user-facing scheduling/reminder MCP tools and Home Tab user-schedules section. **Renamed** from `config.allowScheduledMessages`.
  - `config.cron.maxRunHistory` — **renamed** from `config.scheduledMessagesMaxRunHistory`.
- Cron tick loop is gated by `cron.enabled` only. Plugin cron jobs fire whenever the scheduler runs.
- When `cron.userSchedules` is `false`, the scheduler skips any persisted job with `createdBy != null` at tick time. The Home Tab hides its user-schedules section. The user-facing MCP tools are not registered.
- Config validation: if `cron.enabled === false` and `cron.userSchedules === true`, log a warning and coerce `userSchedules` to `false`.
- Add `sdk.error(reason: string): void` — plugins call this during init to record one or more load-time errors. Non-fatal; plugins decide whether to also `return` early.
- Add `sdk.capabilities.crons: boolean` — plugins read this to decide whether they can run.
- `PluginLoadResult` gains `errors: string[]`. The plugin registry's catch block now pushes a synthetic result with the thrown message in `errors[]` instead of silently dropping the plugin.
- Home Tab `Status > Plugins` section renders a per-plugin error banner whenever `errors[].length > 0`.
- Trivia plugin self-checks `sdk.capabilities.crons` at init. When crons are disabled, it calls `sdk.error("Trivia requires the cron scheduler. Enable it via `config.cron.enabled: true`.")` and returns without registering tools or cron jobs.
- Boot migration rewrites legacy config fields (`allowScheduledMessages`, `scheduledMessagesMaxRunHistory`) into the new `cron` namespace on first boot.

## Capabilities

### New Capabilities

_None._ All changes extend or modify existing capabilities.

### Modified Capabilities

- `cron-messages`: scheduler gating moves to `config.cron.enabled`; user-created jobs (`createdBy != null`) are filtered at tick time when `cron.userSchedules` is `false`.
- `scheduled-messages`: configuration gate field renamed and namespaced; user-facing MCP tools register under `cron.userSchedules` instead of `allowScheduledMessages`.
- `plugin-cron-reconciliation`: `reconcileCronJobs` no longer silently persists jobs that will never fire; behavior under `cron.enabled === false` is documented (plugins are expected to self-check via `sdk.capabilities.crons`).
- `clack-plugins`: `ClackSdk` gains `error(reason)` and `capabilities.crons`. `PluginLoadResult` gains `errors: string[]`. The registry's exception handler now records the error on a synthetic result instead of dropping the plugin.
- `home-tab`: the `Status > Plugins` section renders a per-plugin error banner when `errors[].length > 0`. The user-schedules subsection is hidden when `cron.userSchedules === false`.
- `boot-migrations`: a new boot migration rewrites the legacy top-level `allowScheduledMessages` and `scheduledMessagesMaxRunHistory` fields into `config.cron.userSchedules` and `config.cron.maxRunHistory` respectively.
- `trivia-scheduled-prompts`: trivia plugin SHALL refuse to register cron jobs (or any tools/instructions) when `sdk.capabilities.crons === false`, surfacing the reason via `sdk.error`.

## Impact

- **Config schema:** `Config` type gains `cron` block; `allowScheduledMessages` and `scheduledMessagesMaxRunHistory` removed from the canonical shape (boot migration rewrites them).
- **Behavior change for existing deployments:** anyone running with the default `allowScheduledMessages: false` and trivia enabled has been silently storing trivia cron jobs that never fire. After this change, those jobs will fire (because `cron.enabled` defaults to `true`). This is the intended fix, but it changes observable behavior. Deployers who genuinely want no crons must explicitly set `cron.enabled: false` (and accept the trivia plugin self-disabling).
- **Code:** `src/config.ts` (schema + validation + default), `src/lifecycle.ts` (gate at the start path), `src/cronScheduler.ts` (tick-time filter for user jobs), `src/tools/server.ts` (tool registration gate), `src/claude/index.ts` (ctx wiring), `src/plugins/sdk.ts` (new `error` + `capabilities`), `src/plugins/registry.ts` (record errors instead of dropping), `src/plugins/state.ts` (expose errors to consumers), `src/plugins/trivia/index.ts` (self-check), `src/slack/homeTab.ts` (per-plugin error banner + user-schedules section visibility), `src/migrations/` (new migration file).
- **Tests:** existing `lifecycle.test.ts`, `tools/server.test.ts`, `plugins/sdk.test.ts`, `plugins/trivia/integration.gating.test.ts`, and the scheduled-messages tool tests update to reference the new config shape. New tests cover the user-job tick-time filter, the `cron.enabled=false + userSchedules=true` coercion, the trivia self-check, and the registry error-capture path.
- **Migration:** users with explicit values in their old config get them carried forward automatically. Migration logs once at boot.
- **Docs:** `CLAUDE.md` mentions of `allowScheduledMessages` need updating.
