## ADDED Requirements

### Requirement: Attached Topics On User-Created Schedules

The cron-job-backed schedule tools `create_scheduled_message` and `update_scheduled_message` SHALL accept an optional `attached_topics: string[]` argument mapped onto the existing `CronJob.attachedTopics` field. When `create_scheduled_message` is called WITHOUT the argument, the created job SHALL default to `attachedTopics: ["response-rendering"]` so user-created schedules keep rich-output quality. `update_scheduled_message` SHALL support replacing the list and clearing it with an empty array (matching the persistence layer's existing semantics). Supplied topic names SHALL be validated at write time against known topics (topic folders across the role chain, plugin virtual defaults, and registry names); unknown names SHALL be rejected with an error that names the invalid entries and lists the known topic names so the caller can correct the request. The Slack-API `schedule_reminder` tool (one-shot `chat.scheduleMessage`, no Claude session at delivery) SHALL NOT gain the argument.

Existing non-plugin-managed cron jobs missing `attachedTopics` SHALL be stamped with `["response-rendering"]` by a boot migration; plugin-managed jobs are left untouched (plugin reconcile owns their specs).

#### Scenario: Default on create
- **WHEN** `create_scheduled_message` creates a job without `attached_topics`
- **THEN** the persisted job has `attachedTopics: ["response-rendering"]`

#### Scenario: Explicit topics respected
- **WHEN** `create_scheduled_message` is called with `attached_topics: []`
- **THEN** the persisted job has no attached topics and its fires load no rendering-guidance topic

#### Scenario: Update validates names
- **WHEN** `update_scheduled_message` is called with `attached_topics: ["response-rendring"]` (unknown name)
- **THEN** the tool returns an error naming the invalid topic and the job is unchanged

#### Scenario: Migration stamps existing user jobs
- **GIVEN** a pre-existing user-created cron job with no `attachedTopics`
- **WHEN** the boot migration runs
- **THEN** the job carries `attachedTopics: ["response-rendering"]`
- **AND** plugin-managed jobs are not modified
