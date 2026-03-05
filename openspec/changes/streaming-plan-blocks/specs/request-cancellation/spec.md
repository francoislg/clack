## MODIFIED Requirements

### Requirement: In-Flight Request Registry
The registry entries no longer include thinking state. Stream cleanup is handled by the query processing flow, not the message edit handler.

#### Scenario: Request registered on invocation start
- **WHEN** `processMessage()` begins a Claude invocation
- **AND** the trigger type is `mentions` or `directMessages`
- **THEN** the registry stores an entry with the `AbortController`, session ID, and trigger type
- **AND** the entry does NOT include thinking state (streaming is managed by `processMessage`)

### Requirement: Abort and Restart on Edit
Stream cleanup on abort is no longer handled by the message edit handler. Instead, `processMessage` detects the cancelled response and stops the stream.

#### Scenario: Stream cleanup on abort
- **WHEN** a message edit aborts an in-flight request
- **THEN** the message edit handler deregisters and aborts, but does NOT clean up any UI
- **AND** `processMessage` detects `response.cancelled` and calls `streamer.stop({ markdownText: "_Request cancelled._" })`

## REMOVED Requirements

### Requirement: Thinking Indicator Cleanup on Abort
**Reason**: Thinking indicators (emoji reactions, "Investigating..." messages) no longer exist. They are replaced by the chat stream, which is cleaned up by `processMessage` via `streamer.stop()` — not by the message edit handler.
**Migration**: No action needed. Stream lifecycle is managed in the `processMessage` finally block.
