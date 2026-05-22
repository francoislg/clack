# slack-assistant Specification

## Purpose
Handle DM-based interactions via Slack's Agents & Assistants API using a Bolt Assistant instance.
## Requirements
### Requirement: Assistant Registration
The system SHALL register a Bolt `Assistant` instance to handle all DM-based interactions via Slack's Agents & Assistants API, gated on `config.directMessages.enabled`.

#### Scenario: Assistant registered on startup
- **GIVEN** `config.directMessages.enabled` is `true`
- **WHEN** the Slack app is created
- **THEN** the system registers an `Assistant` with `threadStarted`, `userMessage`, and `threadContextChanged` handlers
- **AND** the Assistant intercepts all DM thread messages (replacing directMessageHandler and threadReplyHandler)

### Requirement: Thread Started Setup
The system SHALL save context and show suggested prompts when users open a new assistant thread.

#### Scenario: User opens new assistant thread
- **WHEN** a user opens a new thread with the assistant
- **THEN** the system calls `saveThreadContext()` to persist the channel context
- **AND** calls `setSuggestedPrompts()` with example prompts
- **AND** does NOT send a greeting message or create a session

### Requirement: User Message Processing
The system SHALL process user messages in assistant threads through the standard `processMessage` flow.

#### Scenario: User sends message in assistant thread
- **WHEN** a user sends a message in an assistant thread
- **THEN** the system calls `setStatus("Thinking...")`
- **AND** extracts the saved context `channel_id` and stores it as `assistantOriginChannelId` (first message only) and `assistantCurrentChannelId` on the session
- **AND** processes the message via `processMessage` with `triggerType: "directMessages"`

#### Scenario: Follow-up message in assistant thread
- **WHEN** a user sends a follow-up message in an existing assistant thread
- **THEN** the system continues the existing session
- **AND** processes the message with full conversation history

### Requirement: Assistant Thread Title
The system SHALL set a descriptive title on assistant threads after the first response.

#### Scenario: Title set after response
- **WHEN** `processMessage` completes successfully in an assistant thread
- **THEN** the handler calls `setTitle()` with a short summary derived from the user's question

### Requirement: Send to Thread from Assistant
The system SHALL support posting assistant answers to the channel the user was viewing.

#### Scenario: User clicks Send to Thread in assistant thread
- **GIVEN** the session has `assistantCurrentChannelId` set (no `originChannel`)
- **WHEN** a user clicks the "Send to thread" button
- **THEN** the system posts the answer to `assistantCurrentChannelId` as a top-level message

#### Scenario: User clicks Send to Thread in DM-first thread
- **GIVEN** the session has `originChannel` and `originThreadTs` set
- **WHEN** a user clicks the "Send to thread" button
- **THEN** the existing behavior is preserved (post to original thread)

### Requirement: Delivery Context for Assistant
The system SHALL inform Claude of its delivery context when in an assistant thread.

#### Scenario: Claude receives assistant delivery context
- **GIVEN** the session has `assistantOriginChannelId` set
- **WHEN** Claude's prompt is built
- **THEN** `buildDeliveryContext` tells Claude it's in a private assistant thread
- **AND** instructs Claude that `send_to_thread` shares the answer to the channel

### Requirement: Context Channel Tracking
The system SHALL track both the original and current channel for assistant threads.

#### Scenario: User opens assistant from a channel
- **WHEN** `threadStarted` or first `userMessage` fires
- **THEN** `assistantOriginChannelId` is set to the context `channel_id`
- **AND** `assistantCurrentChannelId` is set to the same value

#### Scenario: User switches channels while assistant is open
- **WHEN** `threadContextChanged` fires with a new `channel_id`
- **THEN** `assistantCurrentChannelId` is updated to the new `channel_id`
- **AND** `assistantOriginChannelId` is NOT changed

## ADDED Requirements

### Requirement: Localized Assistant Suggested Prompts and Bot-Authored Strings

Bot-authored strings emitted by the Slack Assistant integration SHALL be sourced from the localization dictionary via the `t()` helper. This includes:

- The set of suggested prompts shown when a user opens a new assistant thread (`setSuggestedPrompts`).
- The status text passed to `setStatus` (e.g. "Thinking…").
- The thread title text passed to `setTitle` when the bot generates a fallback title (Claude-generated titles follow the language directive and require no `t()` call).
- The "Send to thread" button label (and any other assistant-action button labels owned by Clack rather than Claude).

#### Scenario: Suggested prompts localized

- **GIVEN** the configured language is `"fr"`
- **WHEN** a user opens a new assistant thread
- **THEN** `setSuggestedPrompts` is called with French prompt strings sourced via `t()`

#### Scenario: setStatus text localized

- **GIVEN** the configured language is `"fr"`
- **WHEN** the assistant handler calls `setStatus`
- **THEN** the status text is in French via `t()` (e.g. "Réflexion en cours…")

#### Scenario: Send-to-thread button label localized

- **GIVEN** the configured language is `"fr"`
- **WHEN** the assistant renders a message with the "Send to thread" action button
- **THEN** the button label is in French via `t()`

#### Scenario: Claude-authored assistant title follows language directive

- **GIVEN** the configured language is `"fr"`
- **WHEN** Claude generates a thread-title summary and the handler calls `setTitle`
- **THEN** the title is in French because Claude produces it under the language directive
- **AND** no `t()` lookup is required on this path

### Requirement: Assistant Delivery Context Preserves Pre-Localization Output

The `buildDeliveryContext` helper SHALL produce output byte-identical to its pre-localization form when the configured language is `"en"` or absent. The language directive itself SHALL be carried by `buildSystemPrompt` (per the `instruction-system` and `localization` capabilities), not duplicated into `buildDeliveryContext`.

#### Scenario: Delivery context unchanged when language is "en"

- **GIVEN** the configured language is `"en"` (or absent)
- **WHEN** `buildDeliveryContext` is rendered for Claude's prompt
- **THEN** the rendered text MUST be byte-identical to the pre-localization output
- **AND** the delivery context MUST NOT contain any language-related markers or reminders

#### Scenario: Delivery context unchanged when language is "fr"

- **GIVEN** the configured language is `"fr"` AND the session has `assistantOriginChannelId` set
- **WHEN** `buildDeliveryContext` is rendered for Claude's prompt
- **THEN** the rendered text MUST be byte-identical to the EN-language output for the same session state
- **AND** the language directive MUST be supplied by `buildSystemPrompt`, not duplicated into the delivery context
