## Why

When a user sends a follow-up message in a thread while Clack is still answering the previous one, the second message either spawns a parallel session that races on `session_id` (mentions/DMs) or gets silently dropped (auto-respond's `processingThreads` lock). In worker mode, there is no way at all to inject additional context into a long-running change — the user just has to wait, watch it go in the wrong direction, and start over. Both pain points have the same root cause: the SDK Query is built in string-prompt mode and treated as a one-shot, so there is no surface to push extra input into a run that is already in flight.

## What Changes

- **BREAKING (internal)** `clackSession` in `src/claude/query.ts` switches to streaming-input mode (`prompt: AsyncIterable<SDKUserMessage>`) and returns a `ClaudeRunHandle` instead of a bare async iterable. The `clackQuery` (fire-and-forget) wrapper is unchanged.
- Introduce `ClaudeRunHandle`, a small object that owns the live Query and exposes `sendUpdate(text)`, `stop(reason?)`, `futureResponse: Promise<ClaudeResponse>`, and a `status` field. Every `clackSession` invocation returns one.
- `askClaude` (`src/claude/index.ts`) and `executeChange` (`src/changes/execution.ts`) return `ClaudeRunHandle` instead of awaiting a single `ClaudeResponse`. Existing call sites await `handle.futureResponse` where they used to await the function directly — same delivered value, same streamer flow.
- Replace the `(channelId, messageTs)`-keyed `inFlightRequests` registry with a `(channelId, threadTs)`-keyed **active-runs registry** that stores the `ClaudeRunHandle` itself. Invariant: at most one active run per thread.
- Slack handler entry points (`mention`, `dmActions`, `autoRespond`, `newQuery`) consult the active-runs registry before spawning a new session. If a run exists for the thread, they call `run.sendUpdate(text)`; if `sendUpdate` rejects (run already settled), they fall back to spawning a fresh session.
- `stopPipeline` collapses to `run.stop()`; `withInFlightTracking` in `core.ts` is removed (the handle self-registers); `messageChanged.ts` calls `run.stop()` + restart instead of poking an `AbortController`.
- Worker mode (`changes/workflow.ts`) stores the handle on `activeChange` instead of an `AbortController`. Follow-up messages in a change thread route through `sendUpdate` — the worker sees them as queued user messages on its next turn.
- `autoRespond.ts` removes its `processingThreads` Set; the active-runs registry replaces it as the single source of truth for "is a run in flight here?"

## Capabilities

### New Capabilities

- `claude-run-handle`: Defines the `ClaudeRunHandle` shape, lifecycle (running → settled | stopped), and the contract that all multi-turn `clackSession` callers expose one. Covers `sendUpdate`, `stop`, `futureResponse`, `status`, and the rejection semantics when a handle is no longer running.
- `active-runs-registry`: Defines the `(channelId, threadTs)`-keyed registry that stores at most one `ClaudeRunHandle` per thread, the self-registration / self-deregistration contract, and the lookup API used by Slack handlers to decide between `sendUpdate` and spawning a fresh run.

### Modified Capabilities

- `sdk-session-wrapper`: `clackSession` returns a `ClaudeRunHandle` instead of an `AsyncIterable<SDKMessage>`, and accepts the initial prompt as the first item pushed into an internal input stream rather than as a `prompt: string`. Resume-fallback semantics are preserved by replaying the first pushed message into the fresh Query's input stream.
- `request-cancellation`: The in-flight registry switches from `(channelId, messageTs)` keying to `(channelId, threadTs)` keying. Cancellation is invoked via `run.stop()` rather than `abortController.abort()`. The registry stores `ClaudeRunHandle` references; per-message metadata moves to the streamer / delivery context.
- `worker-cancellation`: `activeChange.abortController` becomes `activeChange.handle`. Stopping a worker calls `handle.stop()`, which now also covers the input-stream close that was previously implicit in the AbortController teardown.
- `auto-respond`: The `processingThreads` Set is removed. Detection of "a run is already active in this thread" routes through the active-runs registry; collisions become `sendUpdate` calls instead of silent drops.

## Impact

**Affected files (source):**

- `src/claude/query.ts` — wrapper rewrite; new return type
- `src/claude/index.ts` — for-await loop continues to single `result`; function returns handle
- `src/claude/messageParser.ts` — `result` field reset between turns (low risk; today only one is observed)
- `src/changes/execution.ts` — same loop change; returns handle
- `src/changes/workflow.ts` — store handle instead of `AbortController`; route follow-ups via `sendUpdate`
- `src/slack/inFlightRequests.ts` — replaced by new `activeRuns.ts` module (or repurposed)
- `src/slack/stopPipeline.ts` — collapses to `run.stop()`
- `src/slack/handlers/core.ts` — drop `withInFlightTracking`; consult registry before spawning
- `src/slack/handlers/handlerResponse.ts` — await `handle.futureResponse` instead of `askClaude` directly
- `src/slack/handlers/autoRespond.ts` — drop `processingThreads`; use registry; route to `sendUpdate`
- `src/slack/handlers/mention.ts`, `dmActions.ts`, `newQuery.ts` — consult registry; route to `sendUpdate` on hit
- `src/slack/handlers/messageChanged.ts` — call `run.stop()` instead of `abortController.abort()`

**Affected tests:**

- `src/slack/handlers/core.test.ts`
- `src/slack/handlers/autoRespond.test.ts`
- `src/slack/handlers/messageChanged.test.ts`
- `src/slack/handlers/handlerResponse.test.ts`
- New tests for `query.ts` (wrapper return shape) and the active-runs registry

**Out of scope (confirmed unchanged):**

- `clackQuery` and its 5 call sites (`preAnalysis`, `utilities`, `testMcp`, `migrations/engine`, `startupBaselineSmoke`) — fire-and-forget, no queue concept.
- `data/` layout, role/permission system, instruction system, MCP catalog, session persistence.
- `SlackStreamer` API surface.
- `ClaudeMessageParser` — only its single-`result` reset semantics; no API change.

**Behavioral notes:**

- `sendUpdate` is non-interrupting. The model sees the new message after the current turn finishes (i.e., after the next `result`). This matches the SDK's streaming-input semantics.
- A future iteration may add `amendContext(text)` that calls `query.interrupt()` first; this proposal does not include it.
- `futureResponse` resolves with the result of the FIRST turn (Option A — first-result wins). Once the first `result` arrives, the handle's status flips to `settled` and further `sendUpdate` calls reject; callers spawn a fresh run instead. This keeps the streamer 1:1 with one Slack triggering message, exactly as today.
- The `(channelId, messageTs)` lookup that `messageChanged.ts` does today is replaced by a `(channelId, threadTs)` lookup. For top-level (non-threaded) triggering messages, `threadTs` equals the message's own ts — the existing key already encodes this fallback.
