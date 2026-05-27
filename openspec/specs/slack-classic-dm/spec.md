# slack-classic-dm Specification

## Purpose
Handle DM-based interactions via low-level `message.im` event listeners when classic DM mode is selected, providing an alternative to the Slack Agents & Assistants API.

## Requirements

### Requirement: DM Type Configuration

The system SHALL support an opt-in `directMessages.dmType` field with the values `"assistant"` (default) and `"classic"`. When absent or set to `"assistant"`, the bot uses the Slack Agents & Assistants API (existing behavior). When set to `"classic"`, the bot uses the low-level `message.im` event for all DM handling.

#### Scenario: dmType absent defaults to assistant

- **WHEN** `directMessages.dmType` is not set in the configuration
- **THEN** the resolved DM type SHALL be `"assistant"`
- **AND** behavior SHALL be byte-identical to a configuration without the field

#### Scenario: dmType set to classic

- **WHEN** `directMessages.dmType` is set to `"classic"` and `directMessages.enabled` is `true`
- **THEN** the system SHALL register the classic DM handler
- **AND** the system SHALL NOT register the Bolt `Assistant` instance

#### Scenario: Invalid dmType rejected at config load

- **WHEN** `directMessages.dmType` is set to any value other than `"assistant"` or `"classic"`
- **THEN** config loading SHALL fail with a clear error identifying the invalid field and the accepted values

### Requirement: Classic DM Listener Registration

The system SHALL register a single `app.event("message")` listener when `directMessages.enabled` is `true` AND `directMessages.dmType === "classic"`. The classic listener and the Bolt `Assistant` instance SHALL be mutually exclusive — only one is registered per boot.

#### Scenario: Classic listener registered when dmType is classic

- **GIVEN** `directMessages.enabled` is `true` AND `directMessages.dmType` is `"classic"`
- **WHEN** the Slack app is created
- **THEN** the system SHALL register the classic DM handler via `app.event("message")`
- **AND** the system SHALL NOT call `app.assistant(...)`

#### Scenario: Classic listener not registered when DMs are disabled

- **GIVEN** `directMessages.enabled` is `false`
- **WHEN** the Slack app is created
- **THEN** the system SHALL NOT register the classic DM handler regardless of the `dmType` value

#### Scenario: Switching dmType requires restart and manifest re-upload

- **GIVEN** an operator changes `directMessages.dmType` in `data/config.json`
- **WHEN** the bot is running
- **THEN** the new mode SHALL NOT take effect until the bot restarts
- **AND** the operator SHALL regenerate and re-upload the Slack app manifest because the subscribed bot events differ between the two modes

### Requirement: Classic DM Event Filtering

The classic DM handler SHALL filter `message` events at the listener boundary so that only user-authored DMs reach `processMessage`. Filtering rules: `channel_type === "im"`, no `bot_id`, no `subtype`, and at least one of `text` or `files` is present.

#### Scenario: Non-DM channel types ignored

- **WHEN** the classic handler receives a `message` event whose `channel_type` is not `"im"`
- **THEN** the handler SHALL return without calling `processMessage`

#### Scenario: Bot messages ignored

- **WHEN** the classic handler receives a `message` event with `bot_id` set
- **THEN** the handler SHALL return without calling `processMessage`

#### Scenario: Subtyped messages ignored

- **WHEN** the classic handler receives a `message` event with any `subtype` (including `message_changed`, `message_deleted`, `bot_message`)
- **THEN** the handler SHALL return without calling `processMessage`
- **AND** edit-cancellation behavior remains the responsibility of the existing `messageChanged` handler

#### Scenario: Empty messages ignored

- **WHEN** the classic handler receives a DM with no `text` AND no `files`
- **THEN** the handler SHALL return without calling `processMessage`

### Requirement: Classic DM Routing Through processMessage

The classic DM handler SHALL route every filtered DM through the existing `processMessage(...)` function with `triggerType: "directMessages"`. The handler SHALL pass `threadTs` from the inbound event when present, allowing `processMessage` to continue an existing session or create a new one as appropriate. The handler SHALL NOT duplicate session, streaming, tool, or delivery logic.

#### Scenario: New top-level DM creates a new session

- **WHEN** a user sends a DM with no `thread_ts`
- **THEN** the handler SHALL call `processMessage` with `threadTs: undefined`
- **AND** `processMessage` SHALL create a new session keyed by the DM's `ts`

#### Scenario: Thread reply continues the existing session

- **WHEN** a user sends a DM with `thread_ts` set to a value different from `ts`
- **THEN** the handler SHALL call `processMessage` with `threadTs: <thread_ts>`
- **AND** `processMessage` SHALL look up the existing session for that thread and continue it

#### Scenario: Image attachments forwarded

- **WHEN** a DM contains uploaded image files
- **THEN** the handler SHALL invoke `extractAttachments` on the event's `files` and forward the result to `processMessage`

#### Scenario: Image-only DM uses fallback prompt

- **WHEN** a DM contains only image files and no text
- **THEN** the handler SHALL call `processMessage` with a synthesized `messageText` (the same fallback string used by assistant mode)
- **AND** the trigger type SHALL be `"directMessages"`

#### Scenario: assistantChannelId is not set in classic mode

- **WHEN** the classic handler calls `processMessage`
- **THEN** `assistantChannelId` SHALL be `undefined`
- **AND** downstream consumers SHALL behave as they do for mentions and reactions (which never carry this field)

### Requirement: Classic DM Inline Stop Emoji Parity

The classic DM handler SHALL honor the inline stop-emoji detection rule (specified in the `slack-message-trigger` capability) before invoking `processMessage`, matching the behavior of the assistant handler.

#### Scenario: Inline stop emoji in classic DM stops thread

- **WHEN** a user sends a DM in classic mode whose text matches the inline stop-emoji rule
- **THEN** the handler SHALL invoke `stopThread` for the affected thread
- **AND** the handler SHALL NOT call `processMessage`

### Requirement: Classic Mode Skips Assistant-Only Affordances

When `dmType` is `"classic"`, the system SHALL NOT call `setStatus`, `setTitle`, `setSuggestedPrompts`, or `saveThreadContext`. These APIs are part of the Bolt Assistant surface and are unavailable. The system SHALL NOT send a greeting message on conversation start — the first reply is the conversation's first bot message.

#### Scenario: No setStatus call in classic mode

- **WHEN** the classic handler processes a DM
- **THEN** the handler SHALL NOT call `setStatus`
- **AND** the streamer's placeholder-message pattern (used by mentions and reactions) provides the "Thinking…" affordance

#### Scenario: No greeting message on conversation start

- **WHEN** a user sends their first DM to the bot in classic mode
- **THEN** the handler SHALL NOT post a standalone greeting
- **AND** the first message visible to the user SHALL be the response to their query
