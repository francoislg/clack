## MODIFIED Requirements

### Requirement: Channel Name in MCP Tool Results

The system SHALL include the resolved channel name in MCP tool results that return channel identifiers.

#### Scenario: fetch_channel_messages includes channel name
- **WHEN** `fetch_channel_messages` returns results
- **THEN** the result object includes a `channel_name` field with the resolved channel name
- **AND** the existing `channel` field (channel ID) is preserved

#### Scenario: fetch_slack_message includes channel name
- **WHEN** `fetch_slack_message` returns results for a parsed Slack URL
- **THEN** the result object includes a `channel_name` field with the resolved channel name

#### Scenario: Channel name resolution fails in tool
- **WHEN** channel name resolution fails during a tool call
- **THEN** the `channel_name` field is omitted from the result
- **AND** the tool call succeeds with the channel ID only

#### Scenario: fetch_channel_messages includes reactions
- **WHEN** `fetch_channel_messages` returns messages
- **AND** a message has reactions
- **THEN** the message includes a `reactions` array with emoji name and resolved usernames
- **AND** reactions are omitted from messages that have no reactions
