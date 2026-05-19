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

#### Scenario: Create with submitResponseMode

- **WHEN** Claude calls `create_scheduled_message` with `submitResponseMode` set to one of `"always"`, `"optional"`, or `"skipped"`
- **THEN** the tool stores the value on the cron job verbatim
- **AND** subsequent runs use the mode to select the `submit_response` schema variant (see the `submit-response-mode` capability)
- **AND** the tool response confirms the chosen mode

#### Scenario: Create without submitResponseMode

- **WHEN** Claude calls `create_scheduled_message` without `submitResponseMode` (field omitted)
- **THEN** the tool stores the job with no `submitResponseMode` field
- **AND** subsequent runs use today's auto-derivation rules (allowSkip from triggerType + skipConditions)

#### Scenario: Invalid submitResponseMode is rejected

- **WHEN** Claude calls `create_scheduled_message` with `submitResponseMode: "bogus"` (not one of the three valid values)
- **THEN** the tool returns a validation error identifying the offending field
- **AND** no cron job is created

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
