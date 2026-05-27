## MODIFIED Requirements

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
- **WHEN** `sdk.reconcileCronJobs("trivia", [{ specKey: "k1", cronExpression: "0 9 * * 1-5", channel: "C123", prompt: "…", timezone: "America/Montreal", name: "Morning trivia" }])` is called
- **THEN** the persisted job has `name: "Morning trivia"`

#### Scenario: Channelless spec creates a channelless job

- **GIVEN** no cron jobs exist with `plugin === "casual-talk"`
- **WHEN** `sdk.reconcileCronJobs("casual-talk", [{ specKey: "chatter", cronExpression: "*/15 9-16 * * 1-5", prompt: "…", timezone: "UTC" }])` is called (no `channel` field)
- **THEN** a new job is appended to `cron-jobs.json` with no `channel` field
- **AND** the job's `pluginManaged` field is `true`
- **AND** the job's `systemActor` field is `"plugin:casual-talk"`
- **AND** the persisted JSON omits the `channel` key entirely

#### Scenario: Channelless spec round-trips through reconcile updates

- **GIVEN** a persisted channelless plugin-managed cron job with `specKey: "chatter"`, `plugin: "casual-talk"`, no `channel`
- **WHEN** `sdk.reconcileCronJobs("casual-talk", [{ specKey: "chatter", cronExpression: "*/15 9-16 * * 1-5", prompt: "new prompt", timezone: "UTC" }])` is called
- **THEN** the persisted job is updated in place (same `id`)
- **AND** the job still has no `channel` field after the update
- **AND** the `prompt` field is updated to "new prompt"

#### Scenario: Invalid channel string causes the spec to be skipped

- **GIVEN** no cron jobs exist with `plugin === "casual-talk"`
- **WHEN** `sdk.reconcileCronJobs("casual-talk", [{ specKey: "x", cronExpression: "*/15 * * * *", channel: "not-a-channel-id", prompt: "…", timezone: "UTC" }])` is called
- **THEN** the spec is skipped with a logged warning identifying the invalid channel
- **AND** no job is created for that spec
- **AND** sibling valid specs (if any) are reconciled normally

#### Scenario: Switching a job from channel-bound to channelless via re-reconcile

- **GIVEN** a persisted plugin-managed cron job with `specKey: "k1"`, `channel: "C123"`
- **WHEN** `sdk.reconcileCronJobs(<owner>, [{ specKey: "k1", cronExpression: "...", prompt: "...", timezone: "UTC" }])` is called (no `channel` in the new spec)
- **THEN** the persisted job's `channel` field is cleared (the field is removed from the row)
- **AND** the job otherwise persists in place with the updated `prompt` / `cronExpression` / etc.
