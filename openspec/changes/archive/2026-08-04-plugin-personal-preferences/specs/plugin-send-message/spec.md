## ADDED Requirements

### Requirement: SDK can DM an arbitrary user

The plugin SDK SHALL expose a method, `dmUser`, that sends a single direct message to an arbitrary Slack user identified by user ID. It SHALL open (or reuse) the user's DM channel via `conversations.open` and post via `chat.postMessage`, following the core cron-scheduler DM pattern. It SHALL accept `(userId, text, options?)` where `options` may carry `suppressUnfurls`, route through the live Slack client obtained from `getSlackClient()`, and return a `Result`-shaped value (`{ ok: true }` on success, `{ ok: false; error }` otherwise) — mirroring `dmOwner`. It SHALL NOT throw on a disconnected client, a failure to open the DM channel, or a Slack API error; all surface as `{ ok: false }`. This is plugin-trusted plumbing and is independent of the query-tool guard that blocks user-directed third-party DMs.

#### Scenario: DM delivered to a user

- **WHEN** a plugin calls `dmUser(userId, text)`
- **THEN** the user's DM channel is opened and the message is posted there
- **AND** the call returns `{ ok: true }`

#### Scenario: Unfurl suppression honored

- **WHEN** a plugin calls `dmUser(userId, text, { suppressUnfurls: true })`
- **THEN** the message is posted with link unfurling suppressed

#### Scenario: DM channel cannot be opened fails soft

- **WHEN** `conversations.open` returns no channel or throws
- **THEN** the call returns `{ ok: false, error }` and does not throw

#### Scenario: Disconnected client fails soft

- **WHEN** `dmUser` is called before the Slack client is connected
- **THEN** the call returns `{ ok: false, error }` and does not throw

#### Scenario: Slack API error fails soft

- **WHEN** the underlying `chat.postMessage` throws or returns a non-ok response
- **THEN** the call returns `{ ok: false, error }` and logs a warning
