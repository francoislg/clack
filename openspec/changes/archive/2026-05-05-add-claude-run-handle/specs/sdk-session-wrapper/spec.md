## MODIFIED Requirements

### Requirement: Query Wrapper Functions

The system SHALL provide two wrapper functions (`clackQuery` and `clackSession`) in `src/claude/query.ts` that replace all direct imports of `query()` from the Claude Agent SDK. No call site SHALL import `query` directly from `@anthropic-ai/claude-agent-sdk`.

#### Scenario: clackQuery disables session persistence

- **WHEN** a call site uses `clackQuery()` for a fire-and-forget query
- **THEN** the wrapper sets `persistSession: false` on the SDK options
- **AND** returns the same async iterable as the SDK `query()` function
- **AND** does NOT capture or return a session ID

#### Scenario: clackSession returns a ClaudeRunHandle

- **WHEN** a call site uses `clackSession()` for a multi-turn conversation
- **THEN** the wrapper sets `persistSession: true` on the SDK options
- **AND** returns a `ClaudeRunHandle` (per the `claude-run-handle` capability) **synchronously**, without `await`
- **AND** internally constructs the SDK Query in **streaming-input mode** (`prompt: AsyncIterable<SDKUserMessage>`)
- **AND** pushes the caller-provided initial prompt as the first item on the input stream
- **AND** captures the `session_id` from the SDK `init` message and exposes it via the existing `onSessionId` callback

#### Scenario: clackSession supports resume

- **WHEN** `clackSession()` is called with a `resumeSessionId`
- **THEN** the wrapper passes `resume: resumeSessionId` to the SDK `query()` options
- **AND** the SDK loads the full conversation history from the persisted session
- **AND** the run continues to use streaming-input mode for subsequent `sendUpdate` calls

#### Scenario: clackSession without resume starts fresh

- **WHEN** `clackSession()` is called without a `resumeSessionId` (or with `undefined`)
- **THEN** the wrapper starts a fresh SDK session in streaming-input mode
- **AND** the captured session ID is a new UUID

#### Scenario: Resume graceful degradation with replay

- **WHEN** `clackSession()` is called with a `resumeSessionId` that refers to a missing or corrupted session
- **AND** the SDK reports the failure (either by throwing before the first message or by emitting a non-success `result` with the "No conversation found" error pattern)
- **THEN** the wrapper catches the failure and starts a fresh SDK Query without `resume`
- **AND** replays the original initial prompt as the first `SDKUserMessage` on the new input stream
- **AND** replays any messages queued via `sendUpdate` between start and fallback in the order they were queued
- **AND** logs a warning with the failed session ID and error message
- **AND** the `onSessionId` callback receives the new session ID
- **AND** errors occurring after streaming has progressed past the failure window are NOT caught by this fallback — they propagate normally through the handle's `futureResponse`

### Requirement: Wrapper API Passthrough

The system SHALL pass all other SDK query options through the wrappers unchanged.

#### Scenario: Options forwarded to SDK

- **WHEN** either wrapper is called with SDK options (model, systemPrompt, cwd, tools, mcpServers, abortController, etc.)
- **THEN** all options are forwarded to the SDK `query()` call unchanged
- **AND** only `persistSession`, `resume`, and the `prompt` shape (string for `clackQuery`, `AsyncIterable<SDKUserMessage>` for `clackSession`) are set/overridden by the wrapper

## ADDED Requirements

### Requirement: clackSession Streaming-Input Mode

The system SHALL operate `clackSession` in streaming-input mode for every multi-turn invocation. This enables the `ClaudeRunHandle` to push follow-up messages, supports the SDK control methods (`interrupt`, `setPermissionMode`, `setModel`, `setMaxThinkingTokens`, `setMcpServers`) that require streaming-input mode, and provides a uniform input shape for the wrapper's internals.

#### Scenario: Streaming-input mode for new sessions

- **WHEN** `clackSession()` is invoked for a new run
- **THEN** the wrapper constructs the input stream as a pushable async iterable
- **AND** passes that iterable as the `prompt` to the SDK `query()` call
- **AND** pushes the initial user message as the first item

#### Scenario: Control method availability

- **WHEN** `clackSession()` has started a run in streaming-input mode
- **THEN** the live SDK Query exposes `interrupt`, `setPermissionMode`, `setModel`, `setMaxThinkingTokens`, and `setMcpServers`
- **AND** the existing `onQuery` callback (used by `attach_integration`) continues to receive the live Query and continues to work without modification
