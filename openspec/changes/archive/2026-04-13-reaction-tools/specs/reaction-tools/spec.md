## ADDED Requirements

### Requirement: add_reaction Tool

The system SHALL provide an `add_reaction` query tool that adds an emoji reaction to a Slack message.

#### Scenario: Add reaction by channel and timestamp

- **WHEN** Claude calls `add_reaction` with `channel_id`, `message_ts`, and `emoji`
- **THEN** the tool calls Slack's `reactions.add` API with the provided parameters
- **AND** returns a success result confirming the reaction was added

#### Scenario: Add reaction by Slack URL

- **WHEN** Claude calls `add_reaction` with `url` and `emoji`
- **THEN** the tool parses the URL to extract `channel_id` and `message_ts`
- **AND** calls Slack's `reactions.add` API with the extracted parameters

#### Scenario: Idempotent add (already reacted)

- **WHEN** Claude calls `add_reaction` for an emoji already added by the bot
- **THEN** the tool returns a success result (not an error)

#### Scenario: Invalid emoji name

- **WHEN** Claude calls `add_reaction` with an emoji name that does not exist
- **THEN** the tool returns an error result indicating the emoji is invalid

#### Scenario: Message not found

- **WHEN** Claude calls `add_reaction` with a channel/timestamp that does not match a message
- **THEN** the tool returns an error result indicating the message was not found

#### Scenario: Channel not found

- **WHEN** Claude calls `add_reaction` with a channel_id that does not exist
- **THEN** the tool returns an error result indicating the channel was not found

#### Scenario: Invalid URL format

- **WHEN** Claude calls `add_reaction` with a URL that does not match the Slack message URL pattern
- **THEN** the tool returns an error result indicating invalid URL format

#### Scenario: Missing target parameters

- **WHEN** Claude calls `add_reaction` without providing `url` or (`channel_id` + `message_ts`)
- **THEN** the tool returns an error result indicating that a message target is required

#### Scenario: Slack client not available

- **WHEN** the tool is called without a Slack client in the context
- **THEN** the tool returns an error result indicating the Slack client is unavailable

### Requirement: remove_reaction Tool

The system SHALL provide a `remove_reaction` query tool that removes an emoji reaction from a Slack message.

#### Scenario: Remove reaction by channel and timestamp

- **WHEN** Claude calls `remove_reaction` with `channel_id`, `message_ts`, and `emoji`
- **THEN** the tool calls Slack's `reactions.remove` API with the provided parameters
- **AND** returns a success result confirming the reaction was removed

#### Scenario: Remove reaction by Slack URL

- **WHEN** Claude calls `remove_reaction` with `url` and `emoji`
- **THEN** the tool parses the URL to extract `channel_id` and `message_ts`
- **AND** calls Slack's `reactions.remove` API with the extracted parameters

#### Scenario: Idempotent remove (no reaction to remove)

- **WHEN** Claude calls `remove_reaction` for an emoji the bot has not added
- **THEN** the tool returns a success result (not an error)

#### Scenario: Invalid emoji name on remove

- **WHEN** Claude calls `remove_reaction` with an emoji name that does not exist
- **THEN** the tool returns an error result indicating the emoji is invalid

#### Scenario: Message not found on remove

- **WHEN** Claude calls `remove_reaction` with a channel/timestamp that does not match a message
- **THEN** the tool returns an error result indicating the message was not found

#### Scenario: Channel not found on remove

- **WHEN** Claude calls `remove_reaction` with a channel_id that does not exist
- **THEN** the tool returns an error result indicating the channel was not found

#### Scenario: Invalid URL format on remove

- **WHEN** Claude calls `remove_reaction` with a URL that does not match the Slack message URL pattern
- **THEN** the tool returns an error result indicating invalid URL format

#### Scenario: Missing target parameters on remove

- **WHEN** Claude calls `remove_reaction` without providing `url` or (`channel_id` + `message_ts`)
- **THEN** the tool returns an error result indicating that a message target is required

#### Scenario: Slack client not available on remove

- **WHEN** the tool is called without a Slack client in the context
- **THEN** the tool returns an error result indicating the Slack client is unavailable
