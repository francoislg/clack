# scheduled-messages Specification

## Purpose
Scheduled message tools allowing users to schedule, list, and cancel future Slack messages via Claude, with timezone-aware scheduling and a configuration gate.

## Requirements
### Requirement: Schedule a Message

The system SHALL provide a `schedule_reminder` tool that schedules a future message to a Slack channel via `chat.scheduleMessage`.

#### Scenario: Schedule a message with valid parameters

- **WHEN** Claude calls `schedule_reminder` with `channel`, `message`, and `post_at` (ISO 8601 timestamp)
- **THEN** the tool resolves the channel via the shared `resolveChannelId` helper
- **AND** constructs an attributed message: `🔔 Reminder from <@{userId}>:\n{message}`
- **AND** calls `chat.scheduleMessage` with the resolved channel ID, attributed text, and Unix timestamp
- **AND** returns the `scheduled_message_id`, channel, and `post_at` to Claude

#### Scenario: Channel resolution from name

- **WHEN** Claude provides a channel name (e.g., `#ops` or `ops`)
- **THEN** the tool delegates resolution to the shared `resolveChannelId` helper
- **AND** uses the resolved channel ID for scheduling
- **AND** surfaces any resolution error (e.g., channel not found) back to Claude

#### Scenario: Channel provided as channel ID

- **WHEN** Claude provides a channel ID (`C…`, `G…`, or `D…`)
- **THEN** the resolver passes it through unchanged
- **AND** the tool uses it directly for scheduling

#### Scenario: User ID for self-DM

- **WHEN** Claude provides a user ID (`U…`) equal to the requesting user
- **THEN** the resolver opens a DM with that user via `openDmChannel`
- **AND** the tool schedules the message to the resulting DM channel

#### Scenario: User ID for another user rejected

- **WHEN** Claude provides a user ID (`U…`) that does NOT match the requesting user
- **THEN** the resolver returns an error indicating the tool can only DM the requesting user
- **AND** the tool returns the error to Claude without calling `chat.scheduleMessage`

#### Scenario: Scheduling beyond 120-day limit

- **WHEN** the `post_at` timestamp is more than 120 days in the future
- **THEN** the Slack API returns a `time_too_far` error
- **AND** the tool returns this error to Claude
- **AND** Claude communicates the 120-day limit to the user

#### Scenario: Scheduling in the past

- **WHEN** the `post_at` timestamp is in the past
- **THEN** the Slack API returns a `time_in_past` error
- **AND** the tool returns this error to Claude

#### Scenario: Bot not in channel

- **WHEN** the target channel is one the bot is not a member of
- **THEN** the Slack API returns a `channel_not_found` or `not_in_channel` error
- **AND** the tool returns this error to Claude

### Requirement: List Scheduled Messages

The system SHALL provide a `list_reminders` tool that lists all pending scheduled messages via `chat.scheduledMessages.list`.

#### Scenario: List all pending messages

- **WHEN** Claude calls `list_reminders` with no parameters
- **THEN** the tool calls `chat.scheduledMessages.list`
- **AND** returns all pending scheduled messages with their `id`, `channel_id`, `post_at`, `date_created`, and `text`

#### Scenario: Filter by channel

- **WHEN** Claude calls `list_reminders` with an optional `channel` parameter
- **THEN** the tool passes the channel ID to `chat.scheduledMessages.list`
- **AND** returns only messages scheduled for that channel

#### Scenario: No pending messages

- **WHEN** there are no pending scheduled messages
- **THEN** the tool returns an empty list

### Requirement: Cancel a Scheduled Message

The system SHALL provide a `cancel_reminder` tool that cancels a pending scheduled message via `chat.deleteScheduledMessage`.

#### Scenario: Cancel with valid ID

- **WHEN** Claude calls `cancel_reminder` with a `scheduled_message_id` and `channel`
- **THEN** the tool calls `chat.deleteScheduledMessage` with the channel and scheduled message ID
- **AND** returns a success confirmation

#### Scenario: Cancel already-posted message

- **WHEN** the scheduled message has already been posted (past its `post_at` time)
- **THEN** the Slack API returns an `invalid_scheduled_message_id` error
- **AND** the tool returns this error to Claude

#### Scenario: Cancel with invalid ID

- **WHEN** the `scheduled_message_id` does not match any pending message
- **THEN** the Slack API returns an error
- **AND** the tool returns this error to Claude

### Requirement: Timezone-Aware Scheduling

Claude SHALL resolve relative time expressions using the requesting user's Slack timezone.

#### Scenario: User timezone available in context

- **WHEN** Claude prepares a `schedule_reminder` call
- **THEN** the system prompt includes the user's IANA timezone (e.g., `America/New_York`)
- **AND** Claude uses this timezone to convert relative expressions ("tomorrow at 3pm") to an ISO 8601 UTC timestamp

#### Scenario: User timezone unavailable

- **WHEN** the user's timezone could not be resolved from the `UserInfo` cache
- **THEN** Claude asks the user to specify a timezone or provide an absolute time

### Requirement: Configuration Gate

The scheduled message tools SHALL only be available when enabled in configuration.

#### Scenario: Feature disabled (default)

- **WHEN** `allowScheduledMessages` is not set or is `false` in `config.json`
- **THEN** the tool server does NOT register `schedule_reminder`, `list_reminders`, or `cancel_reminder`

#### Scenario: Feature enabled

- **WHEN** `allowScheduledMessages` is `true` in `config.json`
- **AND** a Slack client is available in the tool context
- **THEN** the tool server registers all three scheduled message tools

#### Scenario: Feature enabled but no Slack client

- **WHEN** `allowScheduledMessages` is `true`
- **AND** no Slack client is available (e.g., test context)
- **THEN** the tool server does NOT register the scheduled message tools
