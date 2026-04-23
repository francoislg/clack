## ADDED Requirements

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
