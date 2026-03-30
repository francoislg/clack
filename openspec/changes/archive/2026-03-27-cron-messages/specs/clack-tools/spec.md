## ADDED Requirements

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

### Requirement: cancel_scheduled_message Tool

The system SHALL provide a `cancel_scheduled_message` tool for deleting cron jobs.

#### Scenario: Cancel by ID
- **WHEN** Claude calls `cancel_scheduled_message` with a job `id`
- **THEN** the tool deletes the cron job
- **AND** returns confirmation

#### Scenario: Cancel own job
- **WHEN** a non-admin user cancels a job they created
- **THEN** the tool deletes the job

#### Scenario: Admin cancels any job
- **WHEN** an admin or owner cancels any job
- **THEN** the tool deletes the job regardless of creator

#### Scenario: Cancel non-owned job as non-admin
- **WHEN** a non-admin user attempts to cancel a job created by another user
- **THEN** the tool returns an error indicating insufficient permissions

#### Scenario: Cancel non-existent job
- **WHEN** Claude calls `cancel_scheduled_message` with an ID that does not exist
- **THEN** the tool returns an error indicating the job was not found
