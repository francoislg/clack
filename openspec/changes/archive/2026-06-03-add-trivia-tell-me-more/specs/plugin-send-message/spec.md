## ADDED Requirements

### Requirement: SDK can post a message to a channel or thread

The plugin SDK SHALL expose a method, `sendMessage`, that posts a single Slack message and supports exactly two delivery shapes: a top-level channel message (when no thread anchor is given) and a threaded follow-up (when a `threadTs` is given). It SHALL accept `{ channel, text?, blocks?, threadTs?, suppressUnfurls? }`, require at least one of `text`/`blocks`, route through the live Slack client obtained from `getSlackClient()`, and return a `Result`-shaped value (`{ ok: true; ts; channel }` on success, `{ ok: false; error }` otherwise) — mirroring `dmOwner`. It SHALL NOT throw on a disconnected client or a Slack API error; both surface as `{ ok: false }`.

#### Scenario: Top-level channel message

- **WHEN** a plugin calls `sendMessage({ channel, text })` with no `threadTs`
- **THEN** the message is posted to the channel at top level
- **AND** the call returns `{ ok: true, ts, channel }`

#### Scenario: Threaded follow-up

- **WHEN** a plugin calls `sendMessage({ channel, text, threadTs })`
- **THEN** the message is posted as a reply under `threadTs` in that channel
- **AND** the call returns `{ ok: true, ts, channel }`

#### Scenario: Blocks supported with text fallback

- **WHEN** a plugin calls `sendMessage({ channel, blocks, text })`
- **THEN** the blocks are posted and `text` is used as the notification/accessibility fallback

#### Scenario: Missing content rejected

- **WHEN** a plugin calls `sendMessage({ channel })` with neither `text` nor `blocks`
- **THEN** the call returns `{ ok: false, error }` and posts nothing

#### Scenario: Disconnected client fails soft

- **WHEN** `sendMessage` is called before the Slack client is connected
- **THEN** the call returns `{ ok: false, error }` and does not throw

#### Scenario: Slack API error fails soft

- **WHEN** the underlying `chat.postMessage` throws or returns a non-ok response
- **THEN** the call returns `{ ok: false, error }` and logs a warning
