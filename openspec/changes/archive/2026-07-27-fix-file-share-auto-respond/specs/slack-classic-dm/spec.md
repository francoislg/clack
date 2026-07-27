## MODIFIED Requirements

### Requirement: Classic DM Event Filtering

The classic DM handler SHALL filter `message` events at the listener boundary so that only user-authored DMs reach `processMessage`. Filtering rules: `channel_type === "im"`, no `bot_id`, `subtype` is either absent or one of `"file_share"` / `"thread_broadcast"` / `"me_message"`, and at least one of `text` or `files` is present. Slack stamps those three subtypes on ordinary user-authored messages — respectively one carrying an uploaded file, a thread reply also sent to the channel, and a `/me` message — so such events are user DMs and MUST be admitted. `bot_message` SHALL remain rejected here even though the auto-respond listener admits it, because the DM pipeline must never answer a bot.

#### Scenario: Non-DM channel types ignored

- **WHEN** the classic handler receives a `message` event whose `channel_type` is not `"im"`
- **THEN** the handler SHALL return without calling `processMessage`

#### Scenario: Bot messages ignored

- **WHEN** the classic handler receives a `message` event with `bot_id` set
- **THEN** the handler SHALL return without calling `processMessage`

#### Scenario: Subtyped messages ignored

- **WHEN** the classic handler receives a `message` event with a `subtype` outside the admitted set (including `message_changed`, `message_deleted`, `bot_message`, `channel_join`)
- **THEN** the handler SHALL return without calling `processMessage`
- **AND** edit-cancellation behavior remains the responsibility of the existing `messageChanged` handler

#### Scenario: Thread-broadcast and me_message DMs admitted

- **WHEN** the classic handler receives a DM `message` event with `subtype: "thread_broadcast"` or `subtype: "me_message"` carrying `text`
- **THEN** the handler SHALL admit the event and route it to `processMessage`

#### Scenario: File-share DM admitted

- **WHEN** the classic handler receives a DM `message` event with `subtype: "file_share"` and a `files` array
- **THEN** the handler SHALL admit the event
- **AND** SHALL pass the event's `files` through to `processMessage` as extracted attachments

#### Scenario: Image-only file-share DM admitted

- **WHEN** the classic handler receives a DM `message` event with `subtype: "file_share"`, no `text`, and a `files` array
- **THEN** the handler SHALL admit the event, since the `files` presence satisfies the text-or-files rule

#### Scenario: Empty messages ignored

- **WHEN** the classic handler receives a DM with no `text` AND no `files`
- **THEN** the handler SHALL return without calling `processMessage`
