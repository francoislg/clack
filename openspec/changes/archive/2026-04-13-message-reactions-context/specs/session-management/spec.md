## MODIFIED Requirements

### Requirement: Thread Message Structure
The system SHALL store thread messages with optional user identity fields and optional reaction data.

#### Scenario: Thread message with user names
- **WHEN** `fetchUserNames` is enabled
- **AND** thread context is captured
- **THEN** each `ThreadMessage` includes:
  - `text`: message content
  - `userId`: Slack user ID
  - `isBot`: boolean
  - `ts`: message timestamp
  - `username`: Slack handle (optional)
  - `displayName`: User's display name (optional)
  - `reactions`: array of `MessageReaction` (optional, present when the message has reactions)
- **AND** each `MessageReaction` includes `emoji` (string), `userIds` (string array), and `usernames` (string array, resolved from user cache)

#### Scenario: Thread message without user names
- **WHEN** `fetchUserNames` is disabled
- **THEN** `ThreadMessage` does not include `username` or `displayName` fields
- **AND** `reactions` may still be present but without resolved `usernames`
- **AND** existing behavior is preserved

#### Scenario: Thread message with no reactions
- **WHEN** a message has no reactions in the Slack API response
- **THEN** the `reactions` field is omitted from the `ThreadMessage`

#### Scenario: Reactions formatted in thread context prompt
- **WHEN** thread context is formatted for the system prompt
- **AND** a message has reactions
- **THEN** a `[reactions: ...]` line is appended after the message text
- **AND** each reaction is formatted as `:emoji: by @username, @username`
- **AND** multiple reactions are separated by semicolons

#### Scenario: No reactions line for unreacted messages
- **WHEN** thread context is formatted for the system prompt
- **AND** a message has no reactions
- **THEN** no `[reactions: ...]` line is appended
