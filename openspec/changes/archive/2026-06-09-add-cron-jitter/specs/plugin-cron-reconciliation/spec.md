## ADDED Requirements

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
