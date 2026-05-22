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
  name?: string;            // optional 1-80 char human-readable label for displays
  requiredTools?: string[];
  skipConditions?: string;
}
```

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
