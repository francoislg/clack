## 1. Cron data model

- [x] 1.1 Add `pluginManaged?: boolean` and `specKey?: string` to the `CronJob` interface in `src/cronJobs.ts`
- [x] 1.2 Update load/save in `src/cronJobs.ts` to round-trip the new fields (omit when absent/false)
- [x] 1.3 Add a `findByPluginOwner(ownerKey)` helper in `src/cronJobs.ts` returning all jobs where `plugin === ownerKey && pluginManaged === true`
- [x] 1.4 Add tests in `src/cronJobs.test.ts` covering the new fields' persistence shape and the owner-lookup helper

## 2. Plugin SDK — reconcile API

- [x] 2.1 Define `CronJobSpec` in `src/plugins/sdk.ts` (exported)
- [x] 2.2 Add `reconcileCronJobs(ownerKey, specs)` to the `ClackSdk` interface
- [x] 2.3 Implement the method in `createClackSdk`: diff against `findByPluginOwner`, validate each spec (cron-parser, channel shape), upsert matches by `specKey` preserving `id`/`runs[]`/`enabled`/`lastRunAt`/`lastRunStatus`, create new specs, delete owner-jobs not in the new list
- [x] 2.4 Log per-spec validation failures with plugin name + `specKey` + reason; skip invalid specs without throwing
- [x] 2.5 Unit tests covering: empty-list deletes all, new spec creates with `pluginManaged: true`, matching spec updates in place, disabled job stays disabled across reconcile, removing a spec deletes even when disabled, foreign-owner jobs untouched, invalid spec is skipped while valid neighbors apply, idempotency on repeat call

## 3. Plugin SDK — watchFile

- [x] 3.1 Add `watchFile(relativePath, callback)` to the `ClackSdk` interface in `src/plugins/sdk.ts`
- [x] 3.2 Implement in `createClackSdk`: validate path (reuse `validateRelativePath`), resolve under `pluginDataDir`, attach an `fs.watch` watcher with the same 500ms debounce pattern as `src/configWatcher.ts`, return the `FSWatcher`
- [x] 3.3 Track every returned watcher on the plugin's load result so `restartAll` can close them
- [x] 3.4 Add watcher teardown to `src/plugins/state.ts` / `src/plugins/registry.ts` (whichever owns the unload step), called from `restartAll` before re-running plugin init
- [x] 3.5 Tests: path-traversal rejected, absolute path rejected, missing-file call does not throw, debounce collapses bursts, watchers torn down on reload (no double-fire across reload cycles)

## 4. Config-file watcher

- [x] 4.1 Add a `config.json` entry to `startConfigWatcher` in `src/configWatcher.ts`
- [x] 4.2 Wire its handler to call into `lifecycle.ts`'s reload entrypoint (export a stable `triggerReload()` if `restartAll` isn't already exported in a callable shape)
- [x] 4.3 Ensure the existing debounce (500ms) applies — single reload per burst
- [x] 4.4 Add a logger info line confirming the watcher attached at boot
- [x] 4.5 Tests: integration-style test that writes to `data/config.json` and asserts `loadPlugins()` is re-invoked exactly once after the debounce window

## 5. Cron tool gates for plugin-managed jobs

- [x] 5.1 In the `update_scheduled_message` tool, reject calls targeting a job where `pluginManaged === true` (except when the only field changing is `enabled`)
- [x] 5.2 In the `delete_scheduled_message` tool, reject calls targeting a job where `pluginManaged === true`
- [x] 5.3 Update the corresponding spec tests to cover the rejection paths

## 6. Trivia plugin — extract prompt builders — MOVED to `add-trivia-games`

Already partly done on disk: `scheduledPrompts.ts` holds the constants; the three instruction-tool wrappers were deleted; `trivia/index.ts` no longer registers them. The remaining trivia integration work (config schema, reconcile call, migration, default-config cleanup) is tracked in the `add-trivia-games` change.

## 7. Trivia plugin — config schema + reconcile — MOVED to `add-trivia-games`

## 8. Legacy trivia cron migration — MOVED to `add-trivia-games`

## 9. Home Tab split

- [x] 9.1 In `src/slack/homeTab.ts`, partition cron jobs into `userCreated` (`!pluginManaged`) and `pluginManaged` lists
- [x] 9.2 Render the existing "Scheduled Messages" block from `userCreated` only (preserve current controls)
- [x] 9.3 Add a new "Plugin Scheduled Messages" block from `pluginManaged`, admin-only, with channel + schedule + plugin name + last-run status + a single Enable/Disable button (no Edit, no Delete)
- [x] 9.4 Include a one-line hint pointing to `data/config.json` (or `trivia.games`) at the bottom of the plugin section
- [x] 9.5 Update the toggle handler to accept both subsections; ensure the existing Delete handler refuses `pluginManaged: true` server-side as a defense in depth
- [x] 9.6 Update the edit-modal opener to refuse opening for `pluginManaged: true` (defensive — the affordance is already removed from the UI)
- [x] 9.7 Home-tab snapshot tests covering: only user jobs (no plugin section), only plugin jobs (no user section), mixed (both sections), non-admin (no plugin section)

## 10. Default-configuration cleanup — MOVED to `add-trivia-games`

## 11. End-to-end verification

- [x] 11.1 Run `npm test` and confirm green
- [x] 11.2 Type-check with `npx tsc`
- [x] 11.3 Lint with `npx oxlint` on all touched files
- [x] 11.4 Format with `npx oxfmt` on all touched files
- [x] 11.5 Manual smoke test (or scripted integration): add a single-game `trivia.games[]` entry to a test config, boot the bot, verify two cron jobs exist with `pluginManaged: true` and the expected fields; edit `questionCron` in the config, verify the job is updated in place (same `id`, new `cronExpression`); remove the entry, verify both jobs are deleted
- [x] 11.6 Manual Home-Tab check: confirm the split renders correctly for an admin, that the plugin section is hidden for a non-admin, that Disable/Enable works, and that no Edit/Delete buttons appear on plugin rows
- [x] 11.7 Manual legacy-migration check: stage a fixture `cron-jobs.json` with one dispatcher pair, boot, verify the migration converts and deletes, the bot reconciles fresh jobs with embedded prompts, and re-running boot is a no-op
