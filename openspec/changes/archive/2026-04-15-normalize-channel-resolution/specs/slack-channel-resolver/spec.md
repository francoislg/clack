## ADDED Requirements

### Requirement: Open DM Channel Primitive

The system SHALL provide an `openDmChannel(client, userId)` helper that opens (or retrieves) a direct message channel for the given user and returns its channel ID.

#### Scenario: Successful DM open

- **WHEN** `openDmChannel` is called with a valid user ID
- **THEN** the system calls `client.conversations.open({ users: userId })`
- **AND** returns the resulting DM channel ID (a `D…` string)

#### Scenario: DM open failure

- **WHEN** `openDmChannel` is called and the Slack API throws or returns no channel
- **THEN** the system logs the error internally
- **AND** returns `null`
- **AND** does NOT throw

#### Scenario: Missing channel in response

- **WHEN** the Slack API returns a response with no `channel.id`
- **THEN** the system returns `null`
- **AND** does NOT throw

### Requirement: Channel-Like Identifier Classification

The system SHALL provide helpers to classify an input string as a Slack channel ID, user ID, or neither.

#### Scenario: Channel ID classification

- **WHEN** `isChannelId(input)` is called with a string matching `/^[CGD][A-Z0-9_]+$/`
- **THEN** it returns `true`

#### Scenario: User ID classification

- **WHEN** `isUserId(input)` is called with a string matching `/^U[A-Z0-9_]+$/`
- **THEN** it returns `true`

#### Scenario: Non-ID rejection

- **WHEN** `isChannelId` or `isUserId` is called with a plain name (e.g., `general`, `#ops`) or a lowercase ID
- **THEN** both functions return `false`

#### Scenario: Disjoint classifications

- **WHEN** any string is classified
- **THEN** it SHALL NOT be classified as both a channel ID and a user ID

### Requirement: Tool-Facing Channel Resolution

The system SHALL provide a `resolveChannelId(ctx, input)` function that accepts a channel-like identifier from a tool and returns a canonical Slack channel ID, with a security boundary on user-ID inputs.

#### Scenario: Channel name resolution

- **WHEN** `input` is a channel name with or without a leading `#`
- **THEN** the resolver strips the `#` if present
- **AND** calls `conversations.list` to look up the channel by name
- **AND** returns `{ ok: true, channelId }` with the matching channel ID
- **AND** returns `{ ok: false, error }` if no match or on API failure

#### Scenario: Channel ID passthrough

- **WHEN** `input` is a channel ID matching `C…`, `G…`, or `D…`
- **THEN** the resolver returns `{ ok: true, channelId: input }` without any API call

#### Scenario: Self-DM user ID

- **WHEN** `input` is a user ID (`U…`)
- **AND** `input === ctx.userId`
- **THEN** the resolver calls `openDmChannel(client, input)`
- **AND** returns `{ ok: true, channelId: <D…> }` with the resulting DM channel ID
- **AND** returns `{ ok: false, error }` if opening the DM fails

#### Scenario: Third-party user ID rejected

- **WHEN** `input` is a user ID (`U…`)
- **AND** `input !== ctx.userId`
- **THEN** the resolver returns `{ ok: false, error }` with a message explaining that the tool can only DM the requesting user
- **AND** does NOT call `conversations.open`

#### Scenario: Unrecognized input

- **WHEN** `input` is neither a channel ID, nor a user ID, nor a channel name that can be looked up
- **THEN** the resolver returns `{ ok: false, error }` with a helpful error message
