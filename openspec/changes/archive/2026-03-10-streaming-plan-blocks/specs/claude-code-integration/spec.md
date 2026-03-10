## MODIFIED Requirements

### Requirement: Claude Code Subprocess Invocation
The `askClaude()` function now supports an `onEvent` callback for real-time streaming of tool call progress.

#### Scenario: onEvent callback for streaming
- **WHEN** `askClaude()` is called with an `onEvent` callback in options
- **THEN** the function emits `StreamEvent` objects as Claude executes
- **AND** `tool_start` events are emitted when `tool_use` blocks appear in the SDK message stream
- **AND** `tool_end` events are emitted when `tool_result` blocks appear
- **AND** the `taskId` field uses the SDK's `tool_use_id` to correlate start/end events

#### Scenario: onEvent callback is optional
- **WHEN** `askClaude()` is called without an `onEvent` callback
- **THEN** the function behaves identically to before (no streaming events emitted)
- **AND** the return type (`ClaudeResponse`) is unchanged

### Requirement: Session Context Continuation (UPDATED)
Refinement is no longer a first-class concept. Thread-based replies replace it.

#### Scenario: Refinement includes previous context (UPDATED)
- **WHEN** a user replies in a thread (DM or channel)
- **THEN** the system fetches full thread context from Slack
- **AND** passes it to Claude as conversation history
- **AND** does NOT use a separate refinement mechanism

### Requirement: Autonomous Change Execution
The `runClaude()` function now supports the same `onEvent` callback for streaming worker tool progress.

#### Scenario: Worker onEvent callback
- **WHEN** `runClaude()` is called with an `onEvent` callback
- **THEN** the function emits `tool_start` events when `tool_use` blocks appear
- **AND** emits `tool_end` events when `tool_result` blocks appear (with error status if `is_error: true`)
- **AND** the caller (change workflow handlers) can wire these events to a `SlackStreamer` for live progress display
