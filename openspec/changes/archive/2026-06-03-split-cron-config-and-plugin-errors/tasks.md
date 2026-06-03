## 1. Config schema and validation

- [x] 1.1 Add `CronConfig` interface to `src/config.ts` with `enabled?: boolean`, `userSchedules?: boolean`, `maxRunHistory?: number`
- [x] 1.2 Add `cron?: CronConfig` to the `Config` interface
- [x] 1.3 Remove `allowScheduledMessages` and `scheduledMessagesMaxRunHistory` from the canonical `Config` shape (keep the type strict; the boot migration handles legacy files)
- [x] 1.4 Add validation: default `cron.enabled` to `true`, default `cron.userSchedules` to `false`
- [x] 1.5 Add validation for the invalid combo: when `cron.enabled === false && cron.userSchedules === true`, log a warning naming both keys and coerce `userSchedules` to `false` in the in-memory config
- [x] 1.6 Update `getScheduledMessagesMaxRunHistory()` to read from `cron.maxRunHistory`; rename to `getCronMaxRunHistory()` (keep the same default-fallback semantics)

## 2. Boot migration

- [x] 2.1 Scaffold a new boot migration via `/create-migration` with name `cron-config-namespace`
- [x] 2.2 In the migration body, read `data/config.json`; if `allowScheduledMessages` is present and `cron.userSchedules` is absent, move the value to `cron.userSchedules`
- [x] 2.3 If `scheduledMessagesMaxRunHistory` is present and `cron.maxRunHistory` is absent, move the value to `cron.maxRunHistory`
- [x] 2.4 Delete the legacy top-level fields after the move
- [x] 2.5 If only legacy fields are present and the new namespace already has values, prefer the new namespace; still delete the legacy keys
- [x] 2.6 Log a single info-level message naming both old and new keys touched
- [x] 2.7 Add a unit test for the migration covering: only-legacy, only-new, both-present (new wins), neither-present, idempotency
- [x] 2.8 Register the migration in the boot-migration runner and the test runner

## 3. Cron scheduler gating

- [x] 3.1 In `src/lifecycle.ts:147`, change the gate from `config.allowScheduledMessages` to `config.cron?.enabled !== false` (default-true semantics)
- [x] 3.2 In `src/cronScheduler.ts`, add a tick-time filter: when `config.cron?.userSchedules !== true`, skip any job with `createdBy != null` before executing it
- [x] 3.3 Ensure the skipped-job branch does NOT record a `runs[]` entry (treat it as if the job didn't match)
- [x] 3.4 Add a unit test for the tick filter: plugin job (`createdBy: null`) fires, user job (`createdBy: "U123"`) is skipped, when `cron.userSchedules` is false
- [x] 3.5 Add a unit test confirming both job types fire when `cron.userSchedules` is true

## 4. Tool registration gating

- [x] 4.1 In `src/tools/server.ts:433`, change `ctx.allowScheduledMessages` reads to read the new `ctx.cronUserSchedules` field
- [x] 4.2 In `src/claude/index.ts:227`, replace `allowScheduledMessages: config.allowScheduledMessages ?? false` with `cronUserSchedules: config.cron?.userSchedules ?? false` on the tool context
- [x] 4.3 Update the `ToolContext` (or equivalent) type definition to rename the field
- [x] 4.4 Update any other call sites that read `ctx.allowScheduledMessages` (search the repo for the field name)

## 5. Plugin SDK additions

- [x] 5.1 In `src/plugins/sdk.ts`, add `error(reason: string): void` method to the `ClackSdk` interface
- [x] 5.2 In `createClackSdk(...)`, implement `error` by pushing onto a per-plugin `errors: string[]` array maintained alongside the existing harvest state
- [x] 5.3 Add `capabilities: { crons: boolean }` to `ClackSdk`; populate `crons` from `config.cron?.enabled !== false` at SDK creation time
- [x] 5.4 Extend `harvest()` to include the accumulated `errors` array in the returned `PluginLoadResult`
- [x] 5.5 Update the `PluginLoadResult` TypeScript type to include `errors: string[]`
- [x] 5.6 Add unit tests in `src/plugins/sdk.test.ts` covering: single `sdk.error` call appends, multiple calls accumulate in order, plugin can continue after `sdk.error`, empty `errors[]` when never called

## 6. Plugin registry error capture

- [x] 6.1 In `src/plugins/registry.ts:126-128`, change the catch block: instead of just logging and continuing, push a synthetic `PluginLoadResult` with `name`, `errors: [String((error as Error)?.message ?? error)]`, and empty `instructions/tools/actionHandlers/viewHandlers`
- [x] 6.2 Keep the existing log line (admins still get a stack trace via logger)
- [x] 6.3 Add unit tests covering: plugin that throws → synthetic result captured with the thrown message; multiple plugins where some throw and some succeed → all appear in results with correct fields

## 7. Trivia plugin self-check

- [x] 7.1 At the top of `src/plugins/trivia/index.ts` plugin function (before any registrations), add `if (!sdk.capabilities.crons) { sdk.error("Trivia requires the cron scheduler. Enable it via `config.cron.enabled: true`."); return; }`
- [x] 7.2 Update `src/plugins/trivia/integration.gating.test.ts` (or add a new test) covering: with `cron.enabled === false`, trivia init reports the documented error and registers nothing
- [x] 7.3 Confirm the existing happy-path tests still pass without modification (they should — `cron.enabled` defaults to `true`)

## 8. Home Tab plugin error banner

- [x] 8.1 In `src/slack/homeTab.ts`, locate the `Status > Plugins` section rendering and iterate over loaded plugins
- [x] 8.2 For each plugin row, when `errors.length > 0`, render a Slack `section` block beneath the row with each error on its own line, prefixed with a warning indicator (e.g. `⚠`)
- [x] 8.3 Gate banner rendering to admins/owners only (match the visibility of the existing `Status` admin-only blocks)
- [x] 8.4 Add localization keys for the banner header text (e.g. `home.plugins.error_header`) and run them through `t()` (project rule: user-facing strings go through `t()`); add to `src/i18n/strings/en.ts` and `src/i18n/strings/fr.ts`
- [x] 8.5 Add a Home Tab unit test (or extend existing) covering: plugin with one error renders a banner; plugin with multiple errors renders multiple lines; plugin with empty errors renders no banner; non-admin view does not render banner

## 9. Home Tab user-schedules visibility

- [x] 9.1 In `src/slack/homeTab.ts`, find the "Scheduled Messages" (user-created) subsection rendering
- [x] 9.2 Wrap its rendering in a check: if `config.cron?.userSchedules !== true`, do not render
- [x] 9.3 Confirm the "Plugin Scheduled Messages" subsection is not affected by this gate (it follows its own admin-only rule)
- [x] 9.4 Add a Home Tab unit test covering: with `cron.userSchedules: false`, the user-schedules subsection is absent for all roles, while the plugin-managed subsection still renders for admins

## 10. Documentation and search-and-update

- [x] 10.1 Update `CLAUDE.md` references to `allowScheduledMessages` (search the file) to use `config.cron.userSchedules`
- [x] 10.2 Update `openspec/project.md` if it references the old config field
- [x] 10.3 Grep the codebase for `allowScheduledMessages` and `scheduledMessagesMaxRunHistory` and confirm only test fixtures intentionally exercising the legacy path remain
- [x] 10.4 Update example/default `data/config.json` files (`data/default_configuration/` if present) to use the new shape

## 11. Test sweep

- [x] 11.1 Update `src/lifecycle.test.ts` fixtures that set `allowScheduledMessages` to use `cron.userSchedules` (or `cron.enabled`, depending on which gate the test exercises)
- [x] 11.2 Update `src/tools/server.test.ts` (if it exists) and the individual `src/tools/actions/createScheduledMessage.test.ts`, `cancelScheduledMessage.test.ts`, `listScheduledMessages.test.ts`, `getScheduledMessageRuns.test.ts` to use the new config shape
- [x] 11.3 Run the full test suite (`npm test`) and address any failures
- [x] 11.4 Run `npx tsc` to confirm the type changes are clean

## 12. Validate change

- [x] 12.1 Run `openspec validate split-cron-config-and-plugin-errors --strict` and resolve any errors
- [x] 12.2 Manually walk the four behavior-matrix combinations (enabled/userSchedules ∈ {true,false}) against a running bot or test harness to confirm the gates behave as specified
- [x] 12.3 Confirm the trivia error banner renders correctly in the Home Tab when `cron.enabled` is set to `false`
