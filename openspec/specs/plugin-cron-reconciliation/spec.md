# plugin-cron-reconciliation Specification

## Purpose
TBD - created by archiving change plugin-managed-schedules. Update Purpose after archive.
## Requirements
### Requirement: Declarative Reconcile API On ClackSdk

The system SHALL expose `sdk.reconcileCronJobs(ownerKey: string, specs: CronJobSpec[]): Promise<void>` on the `ClackSdk` interface. The method SHALL declaratively bring the persisted cron jobs into agreement with `specs[]`: jobs matching `(plugin === ownerKey, specKey === spec.specKey)` are updated in place; entries in `specs[]` without a match are created; and existing jobs with `plugin === ownerKey` whose `specKey` does not appear in `specs[]` are deleted.

Jobs created (or updated) via `reconcileCronJobs` SHALL persist as system-owned: `createdBy` is `null`, `systemActor` is `"plugin:<ownerKey>"`, and `pluginManaged` is `true`. The plugin name SHALL NOT be stored in the `createdBy` field (the legacy shape produced by earlier implementations is rewritten at boot by a one-shot migration).

A `CronJobSpec` is the minimal set of fields a plugin author authoritatively controls:

```ts
interface CronJobSpec {
  specKey: string;          // unique within ownerKey
  cronExpression: string;
  channel?: string;         // Slack channel ID (pre-resolved by the plugin) — OPTIONAL
                            //   omit for channelless jobs that decide delivery at fire time via post_to
  prompt: string;           // already-interpolated, full text
  timezone: string;         // IANA tz
  name?: string;            // optional 1-80 char human-readable label for displays
  requiredTools?: string[];
  skipConditions?: string;
  submitResponseMode?: "always" | "optional" | "skipped";
  skipDates?: SkipDate[];
  attachedTopics?: string[];
}
```

When `spec.channel` is present, it SHALL be validated by the `isChannelId` check (`C…` / `G…` / `D…`); an invalid value SHALL cause the spec to be skipped with a logged warning, exactly as today. When `spec.channel` is absent, the `isChannelId` check SHALL be bypassed and the spec SHALL be accepted as a channelless job — the absence is intentional and is the explicit contract for plugins that decide delivery at fire time.

When `spec.name` is present, it SHALL be passed through to `createJob` (for new entries) and applied to the persisted `name` field (for in-place updates), mirroring the resolution rules used for other spec fields. When `spec.name` is absent, the persisted `name` field SHALL be left unchanged on in-place updates and absent on new entries.

#### Scenario: Empty specs deletes all owner-managed jobs

- **GIVEN** three cron jobs exist with `plugin === "trivia"` and `pluginManaged === true`
- **WHEN** `sdk.reconcileCronJobs("trivia", [])` is called
- **THEN** all three jobs are removed from `cron-jobs.json`
- **AND** cron jobs with `plugin !== "trivia"` are NOT affected

#### Scenario: New specs are created as system-owned

- **GIVEN** no cron jobs exist with `plugin === "trivia"`
- **WHEN** `sdk.reconcileCronJobs("trivia", [{ specKey: "game-a:question", cronExpression: "0 9 * * 1-5", channel: "C123", prompt: "…", timezone: "America/Montreal" }])` is called
- **THEN** a new job is appended to `cron-jobs.json` with a freshly generated `id`
- **AND** the job's `plugin` field is `"trivia"`
- **AND** the job's `pluginManaged` field is `true`
- **AND** the job's `specKey` field is `"game-a:question"`
- **AND** the job's `createdBy` field is `null`
- **AND** the job's `systemActor` field is `"plugin:trivia"`
- **AND** the job's `enabled` field defaults to `true`

#### Scenario: New spec with a name persists the name

- **GIVEN** no cron jobs exist with `plugin === "trivia"`
- **WHEN** `sdk.reconcileCronJobs("trivia", [{ specKey: "game-a:question", name: "Trivia: Game A — daily question", cronExpression: "0 9 * * 1-5", channel: "C123", prompt: "…", timezone: "America/Montreal" }])` is called
- **THEN** the persisted job has `name: "Trivia: Game A — daily question"`

#### Scenario: Existing matching spec is updated in place

- **GIVEN** a cron job exists with `plugin === "trivia"`, `specKey === "game-a:question"`, `id === "abc"`, `cronExpression === "0 9 * * 1-5"`, `prompt === "old"`, `enabled === true`, `createdBy === null`, `systemActor === "plugin:trivia"`, `runs: [...]` with three entries, `lastRunStatus === "success"`
- **WHEN** `sdk.reconcileCronJobs("trivia", [{ specKey: "game-a:question", cronExpression: "0 10 * * 1-5", channel: "C123", prompt: "new", timezone: "America/Montreal" }])` is called
- **THEN** the job's `cronExpression` becomes `"0 10 * * 1-5"`
- **AND** the job's `prompt` becomes `"new"`
- **AND** the job's `id` remains `"abc"`
- **AND** the job's `runs[]` is preserved exactly
- **AND** the job's `lastRunStatus` is preserved
- **AND** the job's `createdBy` remains `null`
- **AND** the job's `systemActor` remains `"plugin:trivia"`

#### Scenario: Existing spec without a name in the spec leaves name untouched

- **GIVEN** a cron job exists with `plugin === "trivia"`, `specKey === "game-a:question"`, `name === "Trivia: Game A — daily question"`
- **WHEN** the same spec is re-reconciled without a `name` field in the `CronJobSpec`
- **THEN** the persisted job retains `name: "Trivia: Game A — daily question"`

#### Scenario: Existing spec with a new name overwrites the persisted name

- **GIVEN** a cron job exists with `plugin === "trivia"`, `specKey === "game-a:question"`, `name === "Trivia: Game A — daily question"`
- **WHEN** the spec is re-reconciled with `name: "Trivia: Game A — morning question"`
- **THEN** the persisted job has `name: "Trivia: Game A — morning question"`

#### Scenario: Admin-disabled job stays disabled across reconcile

- **GIVEN** a cron job with `plugin === "trivia"`, `specKey === "game-a:question"`, `enabled === false` (admin paused it via the Home Tab)
- **WHEN** `sdk.reconcileCronJobs("trivia", [{ specKey: "game-a:question", ... }])` is called with the same `specKey`
- **THEN** the job's `enabled` field remains `false`
- **AND** all other spec fields (`cronExpression`, `prompt`, `channel`, `timezone`, `name`, `requiredTools`, `skipConditions`) are updated to the spec values
- **AND** the job's identity fields (`createdBy`, `systemActor`, `pluginManaged`, `specKey`) are unchanged

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

### Requirement: Boot Migration For Legacy Plugin-Managed Jobs

The system SHALL include a one-shot blocking boot migration that normalizes any cron job rows persisted in the legacy plugin-managed shape (`createdBy: "<pluginName>"`, no `systemActor`) to the system-owned shape (`createdBy: null`, `systemActor: "plugin:<pluginName>"`).

The migration SHALL be guarded by the existing `data/state/migration-version.json` mechanism, run exactly once per deployment, and SHALL NOT modify user-created cron jobs.

#### Scenario: Legacy plugin-managed row is rewritten

- **GIVEN** `data/state/cron-jobs.json` contains a row with `createdBy: "trivia"`, `pluginManaged: true`, `plugin: "trivia"`, `specKey: "game-a:question"`
- **WHEN** the boot migration runs
- **THEN** the row is rewritten to `createdBy: null`, `systemActor: "plugin:trivia"`
- **AND** all other fields (`pluginManaged`, `plugin`, `specKey`, `cronExpression`, `prompt`, `runs[]`, etc.) are preserved
- **AND** the migration logs one `info`-level line per rewritten row identifying the `id` and `specKey`

#### Scenario: Already-migrated row is untouched

- **GIVEN** a row with `createdBy: null`, `systemActor: "plugin:trivia"`, `pluginManaged: true`
- **WHEN** the boot migration runs (e.g. re-running on a fresh deploy that already has normalized data)
- **THEN** the row is left exactly as-is
- **AND** no log lines are emitted for that row

#### Scenario: User-created job is untouched

- **GIVEN** a row with `createdBy: "U123ABC"`, no `pluginManaged`, no `systemActor`
- **WHEN** the boot migration runs
- **THEN** the row is left exactly as-is

#### Scenario: Malformed legacy row is left alone with a warning

- **GIVEN** a row with `pluginManaged: true`, `createdBy: "trivia"`, but missing a valid `plugin` field (empty string or absent)
- **WHEN** the boot migration runs
- **THEN** the row is NOT rewritten (the migration cannot synthesize a `systemActor` from missing source data)
- **AND** the migration logs a `warn`-level line identifying the row's `id` and the reason it was skipped
- **AND** the migration completes successfully (one malformed row does not halt the migration)

### Requirement: Reconcile Is Gated By Plugin Self-Check, Not By Config Field

Plugins that call `sdk.reconcileCronJobs(...)` SHALL be responsible for refusing to do so when `sdk.capabilities.crons` is `false`. The `reconcileCronJobs` method itself SHALL NOT silently no-op or throw based on the `config.cron.enabled` value; if a plugin chooses to call it while crons are disabled, the persistence happens as normal and the jobs simply do not tick (the scheduler is not running). The recommended pattern is for the plugin to check `sdk.capabilities.crons` first and call `sdk.error(reason)` + `return` when it is `false`.

#### Scenario: Plugin self-checks and bows out

- **GIVEN** `config.cron.enabled` is `false`
- **WHEN** the trivia plugin's init function runs
- **THEN** the plugin SHALL read `sdk.capabilities.crons`
- **AND** observe that it is `false`
- **AND** call `sdk.error("Trivia requires the cron scheduler. Enable it via \`config.cron.enabled: true\`.")`
- **AND** return without invoking `sdk.reconcileCronJobs`
- **AND** no trivia entries are added to `data/state/cron-jobs.json`

#### Scenario: Plugin without self-check persists dead jobs

- **GIVEN** `config.cron.enabled` is `false`
- **AND** a plugin does NOT check `sdk.capabilities.crons`
- **WHEN** the plugin's init calls `sdk.reconcileCronJobs("p", specs)`
- **THEN** the SDK SHALL reconcile the persisted jobs as documented
- **AND** the jobs SHALL NOT fire because the scheduler is not running
- **AND** no error is raised by the SDK

#### Scenario: Reconciliation is normal when crons are enabled

- **GIVEN** `config.cron.enabled` is `true`
- **WHEN** a plugin calls `sdk.reconcileCronJobs("p", specs)`
- **THEN** the reconciliation proceeds exactly as documented elsewhere in this capability
- **AND** the jobs tick under the scheduler's normal cadence

### Requirement: CronJobSpec Jitter Passthrough

The `CronJobSpec` interface SHALL accept an OPTIONAL `jitterMinutes?: number` field. `reconcileCronJobs` SHALL thread this value through to the persisted `CronJob` using the declarative clear-on-absent resolution applied to other optional override fields (e.g. `submitResponseMode`, `attentionLevel`): present → applied; absent → cleared on in-place update and absent on create. This keeps the spec authoritative, so removing the field from a plugin's spec drops it from the persisted job.

#### Scenario: New spec with jitter persists the value

- **GIVEN** no cron jobs exist with `plugin === "casual-talk"`
- **WHEN** `sdk.reconcileCronJobs("casual-talk", [{ specKey: "chatter", cronExpression: "*/15 9-15 * * 1-5", prompt: "…", timezone: "America/Montreal", jitterMinutes: 5 }])` is called
- **THEN** the persisted job SHALL have `jitterMinutes === 5`

#### Scenario: Spec without jitter creates a job without the field

- **GIVEN** no cron jobs exist with `plugin === "casual-talk"`
- **WHEN** a spec is reconciled with no `jitterMinutes` value
- **THEN** the persisted job SHALL have `jitterMinutes === undefined`

#### Scenario: Re-reconcile without jitter clears a previously-set value

- **GIVEN** a job exists with `plugin === "casual-talk"`, `specKey === "chatter"`, `jitterMinutes === 6`
- **WHEN** the same `specKey` is reconciled with no `jitterMinutes` value
- **THEN** the persisted job SHALL have `jitterMinutes === undefined`

#### Scenario: In-place update applies a changed jitter value

- **GIVEN** a job exists with `plugin === "casual-talk"`, `specKey === "chatter"`, `jitterMinutes === 5`
- **WHEN** the same `specKey` is reconciled with `jitterMinutes: 8`
- **THEN** the job's `jitterMinutes` SHALL become `8`
- **AND** the job's `id`, `runs[]`, `enabled`, and `lastRunAt` SHALL be preserved

#### Scenario: Invalid jitter on a spec is rejected without breaking neighbors

- **WHEN** a spec carries a `jitterMinutes` outside the accepted range
- **THEN** `validateCronJobSpec` SHALL reject that spec with a logged warning
- **AND** other valid specs in the same reconcile batch SHALL still be applied
