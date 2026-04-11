## MODIFIED Requirements

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
