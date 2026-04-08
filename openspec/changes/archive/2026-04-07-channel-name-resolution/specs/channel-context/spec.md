## ADDED Requirements

### Requirement: Channel Info Cache

The system SHALL cache Slack channel information in memory, resolving channel IDs to names via the Slack `conversations.info` API on first access.

#### Scenario: Cache miss
- **WHEN** a channel ID is not in the cache
- **THEN** the system calls the Slack `conversations.info` API with the channel ID
- **AND** stores the result (`id`, `name`) in the in-memory cache
- **AND** returns the channel info

#### Scenario: Cache hit
- **WHEN** a channel ID is already in the cache
- **THEN** the system returns the cached value
- **AND** does NOT make an API call

#### Scenario: API error handling
- **WHEN** the `conversations.info` API call fails
- **THEN** the system logs the error
- **AND** returns undefined for that channel
- **AND** does NOT cache the failure

#### Scenario: DM channel resolution
- **WHEN** the channel ID refers to a direct message channel
- **THEN** the system resolves it normally (returns whatever name Slack assigns)
- **AND** consumers decide whether to include the name based on trigger type

### Requirement: Channel Name in Session

The system SHALL resolve and store the channel name on the session during session creation.

#### Scenario: Channel name resolved during setup
- **WHEN** a new session is created via `setupSession()`
- **AND** a Slack client is available
- **THEN** the system resolves the channel name via the channel cache
- **AND** stores it as `channelName` on the `SessionContext`

#### Scenario: Channel name unavailable
- **WHEN** channel resolution fails or no Slack client is available
- **THEN** the session's `channelName` field is undefined
- **AND** session creation proceeds normally

### Requirement: Channel Name in Delivery Context

The system SHALL include the channel name in the delivery context prompt for all trigger types except direct messages.

#### Scenario: Non-DM trigger with channel name
- **WHEN** the delivery context is built for a session with `triggerType` other than `"directMessages"`
- **AND** the session has a resolved `channelName`
- **THEN** the delivery context includes `"- Channel: #<channel-name>"`

#### Scenario: DM trigger
- **WHEN** the delivery context is built for a session with `triggerType` `"directMessages"`
- **THEN** the delivery context does NOT include a channel name line

#### Scenario: Channel name not resolved
- **WHEN** the session does not have a `channelName`
- **THEN** the delivery context does NOT include a channel name line

#### Scenario: Assistant panel current channel reference
- **WHEN** the delivery context references the assistant's current channel (`assistantCurrentChannelId`)
- **AND** the channel name is available
- **THEN** the prompt uses the channel name instead of the raw channel ID (e.g., `"viewing channel #backend-dev"` instead of `"viewing channel C0A82GNR25V"`)

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
