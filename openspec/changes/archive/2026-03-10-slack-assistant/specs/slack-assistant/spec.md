## ADDED Requirements

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
