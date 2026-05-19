## ADDED Requirements

### Requirement: Declarative Reconcile API On ClackSdk

The system SHALL expose `sdk.reconcileCronJobs(ownerKey: string, specs: CronJobSpec[]): Promise<void>` on the `ClackSdk` interface. The method SHALL declaratively bring the persisted cron jobs into agreement with `specs[]`: jobs matching `(plugin === ownerKey, specKey === spec.specKey)` are updated in place; entries in `specs[]` without a match are created; and existing jobs with `plugin === ownerKey` whose `specKey` does not appear in `specs[]` are deleted.

A `CronJobSpec` is the minimal set of fields a plugin author authoritatively controls:

```ts
interface CronJobSpec {
  specKey: string;          // unique within ownerKey
  cronExpression: string;
  channel: string;          // Slack channel ID (pre-resolved by the plugin)
  prompt: string;           // already-interpolated, full text
  timezone: string;         // IANA tz
  requiredTools?: string[];
  skipConditions?: string;
}
```

#### Scenario: Empty specs deletes all owner-managed jobs

- **GIVEN** three cron jobs exist with `plugin === "trivia"` and `pluginManaged === true`
- **WHEN** `sdk.reconcileCronJobs("trivia", [])` is called
- **THEN** all three jobs are removed from `cron-jobs.json`
- **AND** cron jobs with `plugin !== "trivia"` are NOT affected

#### Scenario: New specs are created with pluginManaged set

- **GIVEN** no cron jobs exist with `plugin === "trivia"`
- **WHEN** `sdk.reconcileCronJobs("trivia", [{ specKey: "game-a:question", cronExpression: "0 9 * * 1-5", channel: "C123", prompt: "…", timezone: "America/Montreal" }])` is called
- **THEN** a new job is appended to `cron-jobs.json` with a freshly generated `id`
- **AND** the job's `plugin` field is `"trivia"`
- **AND** the job's `pluginManaged` field is `true`
- **AND** the job's `specKey` field is `"game-a:question"`
- **AND** the job's `enabled` field defaults to `true`

#### Scenario: Existing matching spec is updated in place

- **GIVEN** a cron job exists with `plugin === "trivia"`, `specKey === "game-a:question"`, `id === "abc"`, `cronExpression === "0 9 * * 1-5"`, `prompt === "old"`, `enabled === true`, `runs: [...]` with three entries, `lastRunStatus === "success"`
- **WHEN** `sdk.reconcileCronJobs("trivia", [{ specKey: "game-a:question", cronExpression: "0 10 * * 1-5", channel: "C123", prompt: "new", timezone: "America/Montreal" }])` is called
- **THEN** the job's `cronExpression` becomes `"0 10 * * 1-5"`
- **AND** the job's `prompt` becomes `"new"`
- **AND** the job's `id` remains `"abc"`
- **AND** the job's `runs[]` is preserved exactly
- **AND** the job's `lastRunStatus` is preserved

#### Scenario: Admin-disabled job stays disabled across reconcile

- **GIVEN** a cron job with `plugin === "trivia"`, `specKey === "game-a:question"`, `enabled === false` (admin paused it via the Home Tab)
- **WHEN** `sdk.reconcileCronJobs("trivia", [{ specKey: "game-a:question", ... }])` is called with the same `specKey`
- **THEN** the job's `enabled` field remains `false`
- **AND** all other spec fields (`cronExpression`, `prompt`, `channel`, `timezone`, `requiredTools`, `skipConditions`) are updated to the spec values

#### Scenario: Removed spec deletes the job even if disabled

- **GIVEN** a cron job with `plugin === "trivia"`, `specKey === "old-game:question"`, `enabled === false`
- **WHEN** `sdk.reconcileCronJobs("trivia", [])` is called (or a list without `"old-game:question"`)
- **THEN** the job is removed from `cron-jobs.json`

#### Scenario: Reconcile only touches the named owner

- **GIVEN** cron jobs exist with various `plugin` values: `"trivia"` (one), `"weather"` (one), and undefined (user-created, one)
- **WHEN** `sdk.reconcileCronJobs("trivia", [])` is called
- **THEN** only the `plugin === "trivia"` job is deleted
- **AND** the `weather` job is untouched
- **AND** the user-created job is untouched

#### Scenario: Invalid spec is skipped with warning, valid specs proceed

- **WHEN** `sdk.reconcileCronJobs("trivia", [validSpec, invalidSpec])` is called where `invalidSpec.cronExpression` is unparseable by `cron-parser`
- **THEN** the valid spec is applied (created or updated)
- **AND** the invalid spec is logged with the plugin name, `specKey`, and the validation error
- **AND** the reconcile does NOT throw
- **AND** any existing job that matched `invalidSpec.specKey` is left untouched (neither updated to bad data nor deleted)

#### Scenario: Reconcile is idempotent on identical input

- **GIVEN** `sdk.reconcileCronJobs("trivia", specs)` has been called once
- **WHEN** the same call is made again with the same `specs` array
- **THEN** the persisted state on disk is byte-for-byte identical (no spurious writes)
- **AND** no Slack DMs or log warnings are emitted

### Requirement: pluginManaged Field On CronJob

The `CronJob` data model SHALL include an optional `pluginManaged: boolean` field. The field is `true` for jobs created via `reconcileCronJobs` and absent (or `false`) for user-created jobs. The cron scheduler tick treats `pluginManaged` jobs identically to user-created jobs at execution time — the field only governs Home Tab presentation and edit gates.

#### Scenario: User-created job has no pluginManaged

- **WHEN** a job is created via `create_scheduled_message` (the existing user-facing path)
- **THEN** the persisted record has no `pluginManaged` field (or `pluginManaged: false`)

#### Scenario: Plugin-reconciled job carries pluginManaged true

- **WHEN** a job is created via `reconcileCronJobs`
- **THEN** the persisted record has `pluginManaged: true`

#### Scenario: pluginManaged does not affect scheduling

- **GIVEN** two jobs with identical `cronExpression`, `channel`, `prompt`, `timezone`, one with `pluginManaged: true` and one without
- **WHEN** the scheduler tick fires
- **THEN** both jobs execute through the same `processMessage` / `executeDynamicJob` path
- **AND** receive identical `requiredTools` resolution

### Requirement: Reconcile Runs On Plugin Init

The plugin loading lifecycle SHALL re-run plugin init on every `restartAll()` (the existing config-reload pipeline). Plugins that call `sdk.reconcileCronJobs` in their init function SHALL therefore see their cron jobs reconciled against the current config on every reload — without any plugin-side change-detection logic.

#### Scenario: Plugin init reconciles on boot

- **WHEN** the application starts and loads plugins
- **THEN** each plugin's init function runs once
- **AND** any `reconcileCronJobs` call inside that init takes effect

#### Scenario: Plugin init reconciles on config change

- **GIVEN** the application is running and the config-file watcher detects a change to `data/config.json`
- **WHEN** the watcher triggers `restartAll()`
- **THEN** `loadPlugins()` is re-invoked
- **AND** each plugin's init function runs again
- **AND** the next `reconcileCronJobs` call reflects the new config
