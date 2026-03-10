# request-cancellation Specification

## Purpose
TBD - created by syncing change cancel-on-edit. Covers abort/restart of in-flight Claude requests when a user edits their triggering message.

## Requirements

### Requirement: In-Flight Request Registry
The system SHALL maintain an in-memory registry of currently executing Claude invocations, keyed by `channelId:messageTs` (the original triggering message).

#### Scenario: Request registered on invocation start
- **WHEN** `processMessage()` begins a Claude invocation
- **AND** the trigger type is `mentions` or `directMessages`
- **THEN** the registry stores an entry with the `AbortController`, session ID, and trigger type
- **AND** the entry does NOT include thinking state (streaming is managed by `processMessage`)
- **AND** the entry is keyed by `"{channelId}:{messageTs}"`

#### Scenario: Request deregistered on invocation completion
- **WHEN** a Claude invocation completes (success or error)
- **THEN** the registry entry for that invocation is removed
- **AND** this happens in a `finally` block to guarantee cleanup

#### Scenario: Request deregistered on abort
- **WHEN** a Claude invocation is aborted via the `AbortController`
- **THEN** the registry entry is removed before the abort signal is sent
- **AND** subsequent lookups for the same key return no match

#### Scenario: Reactions mode excluded
- **WHEN** a request is triggered via reaction mode
- **THEN** no entry is added to the in-flight registry
- **AND** message edits have no effect on reaction-triggered requests

### Requirement: Message Edit Detection
The system SHALL listen for `message_changed` events and detect edits to messages that triggered an in-flight request.

#### Scenario: Edit detected for in-flight mention request
- **WHEN** a user edits a message that triggered an in-flight @mention request
- **AND** the registry contains an entry for that `channelId:messageTs`
- **THEN** the system aborts the in-flight request

#### Scenario: Edit detected for in-flight DM request
- **WHEN** a user edits a direct message that triggered an in-flight request
- **AND** the registry contains an entry for that `channelId:messageTs`
- **THEN** the system aborts the in-flight request

#### Scenario: Edit ignored when no in-flight request
- **WHEN** a user edits a message
- **AND** no registry entry exists for that `channelId:messageTs`
- **THEN** the system takes no action (the edit is ignored)

### Requirement: Abort and Restart on Edit
The system SHALL abort in-flight requests and optionally restart them with updated text when the triggering message is edited.

#### Scenario: Stream cleanup on abort
- **WHEN** a message edit aborts an in-flight request
- **THEN** the message edit handler deregisters and aborts, but does NOT clean up any UI
- **AND** `processMessage` detects `response.cancelled` and calls `streamer.stop({ markdownText: "_Request cancelled._" })`

#### Scenario: Mention edit with bot mention retained
- **WHEN** a user edits a message that @mentioned the bot
- **AND** the edited text still contains the bot's `<@BOT_ID>` mention
- **THEN** the system aborts the in-flight request
- **AND** restarts `processMessage()` with the new message text (bot mention stripped)

#### Scenario: Mention edit with bot mention removed
- **WHEN** a user edits a message that @mentioned the bot
- **AND** the edited text no longer contains `<@BOT_ID>`
- **THEN** the system aborts the in-flight request
- **AND** does NOT restart processing

#### Scenario: DM edit restarts with new text
- **WHEN** a user edits a direct message that triggered an in-flight request
- **AND** the edited text is not empty
- **THEN** the system aborts the in-flight request
- **AND** restarts `processMessage()` with the new message text

#### Scenario: DM edit with empty text cancels only
- **WHEN** a user edits a direct message to empty text
- **THEN** the system aborts the in-flight request
- **AND** does NOT restart processing

### Requirement: Query Mode Abort Support
The `askClaude()` function SHALL accept an `AbortController` to support cancellation of in-flight queries.

#### Scenario: AbortController passed to Agent SDK
- **WHEN** `askClaude()` is called with an `AbortController` in options
- **THEN** the controller is forwarded to the Agent SDK's `query()` function

#### Scenario: Abort during query streaming
- **WHEN** the `AbortController` is aborted during `askClaude()` streaming
- **THEN** the `for await` loop throws an `AbortError`
- **AND** `askClaude()` returns a response indicating cancellation (not treated as an error to report)

#### Scenario: No AbortController provided
- **WHEN** `askClaude()` is called without an `AbortController`
- **THEN** the function behaves identically to current behavior (no cancellation support)
