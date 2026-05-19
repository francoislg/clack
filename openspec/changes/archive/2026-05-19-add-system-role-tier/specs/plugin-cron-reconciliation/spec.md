## MODIFIED Requirements

### Requirement: Declarative Reconcile API On ClackSdk

The system SHALL expose `sdk.reconcileCronJobs(ownerKey: string, specs: CronJobSpec[]): Promise<void>` on the `ClackSdk` interface. The method SHALL declaratively bring the persisted cron jobs into agreement with `specs[]`: jobs matching `(plugin === ownerKey, specKey === spec.specKey)` are updated in place; entries in `specs[]` without a match are created; and existing jobs with `plugin === ownerKey` whose `specKey` does not appear in `specs[]` are deleted.

Jobs created (or updated) via `reconcileCronJobs` SHALL persist as system-owned: `createdBy` is `null`, `systemActor` is `"plugin:<ownerKey>"`, and `pluginManaged` is `true`. The plugin name SHALL NOT be stored in the `createdBy` field (the legacy shape produced by earlier implementations is rewritten at boot by a one-shot migration).

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

#### Scenario: Admin-disabled job stays disabled across reconcile

- **GIVEN** a cron job with `plugin === "trivia"`, `specKey === "game-a:question"`, `enabled === false` (admin paused it via the Home Tab)
- **WHEN** `sdk.reconcileCronJobs("trivia", [{ specKey: "game-a:question", ... }])` is called with the same `specKey`
- **THEN** the job's `enabled` field remains `false`
- **AND** all other spec fields (`cronExpression`, `prompt`, `channel`, `timezone`, `requiredTools`, `skipConditions`) are updated to the spec values
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

## ADDED Requirements

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
