## MODIFIED Requirements

### Requirement: create_scheduled_message Tool

The system SHALL provide a `create_scheduled_message` tool for creating cron jobs through conversation.

#### Scenario: Create a recurring dynamic job
- **WHEN** Claude calls `create_scheduled_message` with `channel`, `cronExpression`, `prompt`, and `timezone`
- **THEN** the tool resolves the channel name to an ID (if needed)
- **AND** validates the cron expression using `cron-parser`
- **AND** creates the cron job with the creator's user ID
- **AND** returns the job ID, next run time, and human-readable schedule

#### Scenario: Create a static job
- **WHEN** Claude calls `create_scheduled_message` with `channel`, `cronExpression`, `staticMessage`, and `timezone`
- **THEN** the tool creates a cron job that posts the static message directly (no Claude session)

#### Scenario: Create a one-shot job
- **WHEN** Claude calls `create_scheduled_message` with `oneShot: true`
- **THEN** the tool creates a job that auto-deletes after its first execution

#### Scenario: Create with skipConditions
- **WHEN** Claude calls `create_scheduled_message` with a non-empty `skipConditions` string
- **THEN** the tool stores the conditions on the cron job verbatim
- **AND** subsequent runs of the job evaluate the conditions and may skip delivery
- **AND** the tool response indicates that skip conditions were captured

#### Scenario: Specify repositories for dynamic jobs
- **WHEN** Claude calls `create_scheduled_message` with `repositories` array
- **THEN** the tool validates that the creator has read access to the specified repositories
- **AND** stores them on the job for use during execution

#### Scenario: Invalid cron expression
- **WHEN** Claude calls `create_scheduled_message` with an unparseable cron expression
- **THEN** the tool returns an error describing the issue

#### Scenario: Channel resolution failure
- **WHEN** the specified channel cannot be found or the bot is not a member
- **THEN** the tool returns an error indicating the channel issue

#### Scenario: Tool gating
- **WHEN** the tool server is built
- **AND** `allowScheduledMessages` is enabled in config
- **AND** a Slack client is available
- **THEN** the `create_scheduled_message` tool is registered

### Requirement: list_scheduled_messages Tool

The system SHALL provide a `list_scheduled_messages` tool for listing cron jobs.

#### Scenario: List all jobs for user
- **WHEN** Claude calls `list_scheduled_messages` without filters
- **THEN** the tool returns all cron jobs created by the current user
- **AND** each entry includes: id, channel, human-readable schedule, prompt/staticMessage summary, enabled status, last run info
- **AND** each entry includes `skipConditions` when set on the job (omitted otherwise). `skipConditions` is returned to anyone allowed to see the job (creator for their own jobs, admins/owners for all jobs) — it mirrors the visibility of `prompt` and `requiredTools`
- **AND** each entry's last-run status SHALL surface `"skipped"` distinctly from `"success"` and `"error"` when the most recent run was skipped

#### Scenario: List jobs for a channel
- **WHEN** Claude calls `list_scheduled_messages` with a `channel` filter
- **THEN** the tool returns only jobs targeting that channel (created by the current user)

#### Scenario: Admin lists all jobs
- **WHEN** Claude calls `list_scheduled_messages` with `all: true`
- **AND** the current user is an admin or owner
- **THEN** the tool returns all cron jobs across all users

#### Scenario: No scheduled messages
- **WHEN** no cron jobs match the filter
- **THEN** the tool returns an empty list with a descriptive message

## ADDED Requirements

### Requirement: update_scheduled_message Supports skipConditions

The existing `update_scheduled_message` tool SHALL accept an optional `skipConditions` parameter that sets, replaces, or clears the stored value on the target cron job. Edit permissions SHALL match the existing `cancel_scheduled_message` rules: the job's creator OR an admin/owner may update `skipConditions`; other users are rejected.

#### Scenario: Update sets skipConditions
- **WHEN** Claude calls `update_scheduled_message` with a job `id` and a non-empty `skipConditions` string
- **AND** the calling user is the job's creator or an admin/owner
- **THEN** the tool updates the cron job's `skipConditions` field
- **AND** returns confirmation including the new value

#### Scenario: Update clears skipConditions
- **WHEN** Claude calls `update_scheduled_message` with `skipConditions: ""` (empty string)
- **AND** the calling user is the job's creator or an admin/owner
- **THEN** the tool removes the `skipConditions` field from the cron job
- **AND** returns confirmation that conditions were cleared

#### Scenario: Update leaves skipConditions unchanged
- **WHEN** Claude calls `update_scheduled_message` without `skipConditions` in the arguments
- **THEN** the stored field is left unchanged

#### Scenario: Update by non-creator non-admin is rejected
- **WHEN** a non-admin user attempts to update `skipConditions` on a job created by another user
- **THEN** the tool returns an error indicating insufficient permissions
- **AND** no change is persisted

#### Scenario: Update a non-existent job
- **WHEN** Claude calls `update_scheduled_message` with an `id` that does not match any cron job
- **THEN** the tool returns an error indicating the job was not found
- **AND** no job is created

### Requirement: get_scheduled_message_runs Surfaces Skip Outcome

The existing `get_scheduled_message_runs` tool SHALL return the `"skipped"` status on run entries (in addition to `"success"` and `"error"`).

#### Scenario: Runs tool returns skipped entries
- **WHEN** Claude calls `get_scheduled_message_runs` for a job whose history contains skipped runs
- **THEN** each such entry SHALL include `status: "skipped"` and no `responseTs`
- **AND** successful and failed entries remain unchanged
