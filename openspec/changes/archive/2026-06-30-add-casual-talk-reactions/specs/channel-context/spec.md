## MODIFIED Requirements

### Requirement: Channel Name in MCP Tool Results

The system SHALL include the resolved channel name in MCP tool results that return channel identifiers. When the resolved channel has a non-empty Slack `purpose` (a purpose that is neither absent nor an empty string), `fetch_channel_messages` SHALL also include it as a `channel_purpose` field; an absent or empty purpose SHALL be omitted.

#### Scenario: fetch_channel_messages includes channel name
- **WHEN** `fetch_channel_messages` returns results
- **THEN** the result object includes a `channel_name` field with the resolved channel name
- **AND** the existing `channel` field (channel ID) is preserved

#### Scenario: fetch_channel_messages includes channel purpose when available
- **WHEN** `fetch_channel_messages` returns results
- **AND** the resolved channel cache entry has a non-empty `purpose`
- **THEN** the result object includes a `channel_purpose` field with that purpose string

#### Scenario: fetch_channel_messages omits channel purpose when absent
- **WHEN** `fetch_channel_messages` returns results
- **AND** the resolved channel has no `purpose` (or channel resolution failed)
- **THEN** the `channel_purpose` field is omitted from the result
- **AND** the tool call succeeds

#### Scenario: fetch_slack_message includes channel name
- **WHEN** `fetch_slack_message` returns results for a parsed Slack URL
- **THEN** the result object includes a `channel_name` field with the resolved channel name

#### Scenario: Channel resolution fails in tool
- **WHEN** channel resolution fails during a tool call
- **THEN** both the `channel_name` and `channel_purpose` fields are omitted from the result
- **AND** the tool call succeeds with the channel ID only

#### Scenario: fetch_channel_messages includes reactions
- **WHEN** `fetch_channel_messages` returns messages
- **AND** a message has reactions
- **THEN** the message includes a `reactions` array with emoji name and resolved usernames
- **AND** reactions are omitted from messages that have no reactions
