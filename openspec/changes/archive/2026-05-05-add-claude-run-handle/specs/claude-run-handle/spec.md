## ADDED Requirements

### Requirement: ClaudeRunHandle Shape

The system SHALL define a `ClaudeRunHandle` interface representing one in-progress multi-turn Claude run. Every multi-turn `clackSession` invocation SHALL synchronously return a `ClaudeRunHandle`. The handle SHALL expose:

- `sendUpdate(text: string): Promise<void>` — push a follow-up user message into the live Query.
- `stop(reason?: string): Promise<void>` — abort the run.
- `futureResponse: Promise<ClaudeResponse>` — resolves with the run's final response.
- `status: "running" | "settled" | "stopped"` — readable lifecycle state.

#### Scenario: Synchronous return shape

- **WHEN** a caller invokes `clackSession({...})`
- **THEN** the function returns a `ClaudeRunHandle` synchronously (without `await`)
- **AND** the handle's `status` is `"running"` immediately after construction
- **AND** the handle's `futureResponse` is an unresolved `Promise<ClaudeResponse>`

#### Scenario: Initial prompt is the first input

- **WHEN** a caller invokes `clackSession({ prompt: "hello", ... })`
- **THEN** the wrapper internally creates an input stream and pushes a `SDKUserMessage` containing `"hello"` as the first item
- **AND** the SDK Query is started in streaming-input mode

### Requirement: First-Result-Wins Lifecycle

The handle SHALL settle on the first `result` message emitted by the SDK. Once settled, the handle SHALL refuse further `sendUpdate` calls and the input stream SHALL be closed.

#### Scenario: First result resolves futureResponse

- **WHEN** the SDK emits a `result` message (regardless of `subtype`)
- **THEN** the handle resolves `futureResponse` with the corresponding `ClaudeResponse`
- **AND** flips `status` from `"running"` to `"settled"`
- **AND** closes the internal input stream so the SDK Query terminates cleanly

#### Scenario: sendUpdate before first result is delivered to model

- **WHEN** a caller invokes `handle.sendUpdate("more context")` while `status === "running"`
- **AND** the SDK has not yet emitted a `result` message
- **THEN** the wrapper pushes a `SDKUserMessage` containing `"more context"` onto the input stream
- **AND** the model receives the message as the next user input after its current turn ends

#### Scenario: sendUpdate after settle rejects

- **WHEN** a caller invokes `handle.sendUpdate("late context")` while `status !== "running"`
- **THEN** the returned `Promise` rejects with an error indicating the run is no longer running
- **AND** no `SDKUserMessage` is pushed onto the input stream

#### Scenario: sendUpdate during settle race

- **WHEN** the SDK emits a `result` message and the handle begins settling
- **AND** a concurrent `sendUpdate` call is in progress
- **THEN** at most one of these outcomes occurs: (a) the `sendUpdate` completes successfully and is delivered to the model OR (b) `sendUpdate` rejects because settlement won the race
- **AND** the handle's final `status` is `"settled"`

### Requirement: Stop Semantics

The handle SHALL provide a `stop(reason?)` method that aborts the run, settles `futureResponse`, and prevents further `sendUpdate` calls.

#### Scenario: stop while running

- **WHEN** a caller invokes `handle.stop("user requested")` while `status === "running"`
- **THEN** the handle calls `query.interrupt()` on the live SDK Query (best-effort; ignored if the SDK is not in a state that accepts interrupt)
- **AND** the handle aborts its internal `AbortController`
- **AND** closes the internal input stream
- **AND** flips `status` from `"running"` to `"stopped"`
- **AND** resolves `futureResponse` with a `ClaudeResponse` whose `cancelled` is `true`

#### Scenario: stop after settle is a no-op

- **WHEN** a caller invokes `handle.stop()` while `status === "settled"` or `"stopped"`
- **THEN** the call resolves without error
- **AND** `status` is unchanged
- **AND** `futureResponse` is not re-resolved

#### Scenario: sendUpdate after stop rejects

- **WHEN** a caller invokes `handle.sendUpdate(...)` while `status === "stopped"`
- **THEN** the returned `Promise` rejects with an error indicating the run was stopped

### Requirement: Resume-Fallback Replay

When the SDK reports `"No conversation found"` for a `resumeSessionId`, the handle SHALL transparently restart on a fresh session and replay any messages that were pushed before the failure.

#### Scenario: Resume failure replays first message

- **WHEN** `clackSession({ prompt: "hello", resumeSessionId: "abc" })` is called
- **AND** the SDK emits a non-success `result` whose errors match the "No conversation found" pattern (or throws before the first message)
- **THEN** the handle constructs a fresh SDK Query without `resume`
- **AND** pushes the original `"hello"` `SDKUserMessage` as the first item of the new input stream
- **AND** any `SDKUserMessage`s queued via `sendUpdate` between the failed start and the fallback are pushed in order after the first item
- **AND** the handle continues as if the run had started fresh from the beginning (`status` remains `"running"`)

#### Scenario: Resume succeeds on second attempt is not retried

- **WHEN** the resume-fallback fresh session itself fails
- **THEN** the handle does NOT attempt a third start
- **AND** the failure surfaces through `futureResponse` as a rejected/error response

### Requirement: Self-Cleanup on Settlement

The handle SHALL guarantee that all internal resources (input stream, AbortController, registry slot) are released when it settles or is stopped.

#### Scenario: Successful run releases resources

- **WHEN** a run reaches `"settled"` after a normal `result`
- **THEN** the input stream is closed
- **AND** any registry slot held by the handle is released
- **AND** the `AbortController` is no longer referenced by the handle

#### Scenario: Stopped run releases resources

- **WHEN** a run reaches `"stopped"` via `handle.stop()`
- **THEN** the input stream is closed
- **AND** any registry slot held by the handle is released
- **AND** the `AbortController` is aborted exactly once

#### Scenario: Crashed run releases resources

- **WHEN** the for-await loop in the consuming caller throws an error
- **AND** the handle has not yet settled
- **THEN** the handle's resources are released as part of the consumer's `try/finally` cleanup
- **AND** subsequent `sendUpdate` calls reject
