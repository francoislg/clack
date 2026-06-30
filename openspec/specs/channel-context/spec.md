# channel-context Specification

## Purpose
Channel name resolution cache and injection into Claude's context. Resolves opaque Slack channel IDs to human-readable names via the `conversations.info` API, cached in memory for the process lifetime.
## Requirements
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
- **THEN** the system returns the resolved info (DM channels have names like `"dm-user"`)
- **AND** consumers decide whether to use the name based on trigger type

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

### Requirement: fetch_channel_messages Timestamp Input Normalization

The `fetch_channel_messages` tool SHALL accept `oldest` and `latest` arguments as either numeric Unix-epoch strings or `Date.parse`-compatible datetime strings, normalizing them to Slack's epoch-seconds format before invoking the Slack API. Unparseable values SHALL cause the tool to return a tool-level error instead of silently querying an incorrect window.

#### Scenario: Numeric epoch passes through unchanged

- **WHEN** `fetch_channel_messages` is called with `oldest: "1745294400.000000"` or `oldest: "1745294400"`
- **THEN** the tool forwards the value as-is to Slack's `conversations.history` API

#### Scenario: ISO 8601 string normalized to epoch

- **WHEN** `fetch_channel_messages` is called with `oldest: "2026-04-22T00:00:00-04:00"`
- **THEN** the tool parses the string via `Date.parse`
- **AND** converts it to Slack's epoch-seconds timestamp format
- **AND** forwards the normalized value to Slack's `conversations.history` API

#### Scenario: Date-only string normalized to epoch

- **WHEN** `fetch_channel_messages` is called with `oldest: "2026-04-22"`
- **THEN** the tool parses the string via `Date.parse`
- **AND** converts it to epoch seconds
- **AND** forwards the normalized value to Slack's `conversations.history` API

#### Scenario: Unparseable timestamp returns a tool error

- **WHEN** `fetch_channel_messages` is called with `oldest` or `latest` that is neither a numeric epoch string nor a `Date.parse`-compatible datetime string (e.g., `"yesterday"`, `"not-a-date"`)
- **THEN** the tool returns an `errorResult` describing which argument failed and why
- **AND** the Slack API is NOT called

#### Scenario: Omitted timestamps behave unchanged

- **WHEN** `fetch_channel_messages` is called without `oldest` or `latest`
- **THEN** the tool invokes Slack's `conversations.history` without those parameters
- **AND** no normalization is performed

#### Scenario: Inverted window passes through to Slack

- **WHEN** `fetch_channel_messages` is called with a normalized `oldest` that is greater than the normalized `latest`
- **THEN** the tool forwards both values to Slack's `conversations.history` API unchanged
- **AND** does NOT swap, reject, or otherwise modify the bounds
- **AND** the caller is expected to see whatever Slack returns (typically zero messages)

### Requirement: fetch_channel_messages Response Echoes Queried Window

The `fetch_channel_messages` tool SHALL include the effective query window and pagination state in every response, on both empty and non-empty result paths, so the caller can verify the window that was actually queried.

#### Scenario: Response includes normalized oldest and latest when provided

- **WHEN** `fetch_channel_messages` is called with `oldest` and/or `latest` arguments
- **THEN** the response includes `oldest` and/or `latest` fields containing the normalized epoch-seconds strings that were passed to Slack
- **AND** the response includes `oldest_iso` and/or `latest_iso` fields containing the same instants formatted as ISO 8601 strings

#### Scenario: Response omits window fields when no bounds provided

- **WHEN** `fetch_channel_messages` is called without `oldest` or `latest`
- **THEN** the response omits the corresponding fields (`oldest`, `latest`, `oldest_iso`, `latest_iso`)

#### Scenario: Response includes has_more on empty results

- **WHEN** `fetch_channel_messages` returns zero messages
- **THEN** the response includes `has_more` (defaulting to `false` if Slack did not provide one)
- **AND** the response includes any `oldest`/`latest`/`oldest_iso`/`latest_iso` fields per the rules above

#### Scenario: Response includes has_more on non-empty results

- **WHEN** `fetch_channel_messages` returns one or more messages
- **THEN** the response includes `has_more` reflecting Slack's pagination state
- **AND** the response includes any `oldest`/`latest`/`oldest_iso`/`latest_iso` fields per the rules above

