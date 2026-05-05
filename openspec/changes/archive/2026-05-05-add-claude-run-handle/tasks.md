## 1. Foundation: ClaudeRunHandle and registry

- [x] 1.1 Create `src/claude/runHandle.ts` exporting the `ClaudeRunHandle` interface (`sendUpdate`, `stop`, `futureResponse`, `status`) and a factory that wires up the input stream + AbortController + status state machine
- [x] 1.2 Implement an internal pushable async iterable (a small "Subject"/deferred-queue type) used as the SDK `prompt` source — must support `push(item)`, `end()`, and proper async iteration
- [x] 1.3 Add `src/slack/activeRuns.ts` with `register`, `getByThread(channelId, threadTs)`, `unregister` — set-if-absent semantics, single entry per key
- [x] 1.4 Add unit tests for `activeRuns.ts`: registration uniqueness, lookup, deregister, top-level `messageTs === threadTs` invariant
- [x] 1.5 Add unit tests for `runHandle.ts`: status transitions, `sendUpdate` before/after settle, `stop` semantics, slot self-cleanup on settle/stop/crash

## 2. Wrap clackSession in streaming-input mode

- [x] 2.1 In `src/claude/query.ts`, change `clackSession` to construct the SDK Query in streaming-input mode (push initial prompt as first `SDKUserMessage`)
- [x] 2.2 Make `clackSession` synchronously return a `ClaudeRunHandle` instead of an `AsyncIterable<SDKMessage>`
- [x] 2.3 Move the existing for-await loop into the handle's internal worker; wire `result` messages to settle `futureResponse` and close the input stream
- [x] 2.4 Preserve `onSessionId` and `onQuery` callbacks on the new shape (call `onQuery` once per Query construction, including on resume-fallback)
- [x] 2.5 Implement resume-fallback replay: retain the initial `SDKUserMessage` until past the failure window; on fallback, push it (and any queued `sendUpdate` items) into the fresh Query's input stream in order
- [x] 2.6 Add unit tests for `clackSession`: handle return shape, settle on first `result`, resume-fallback replays initial + queued messages

## 3. Adapt askClaude (Q&A path)

- [x] 3.1 Change `src/claude/index.ts` `askClaude` to return a `ClaudeRunHandle` (or a thin wrapper that exposes `sendUpdate`/`stop`/`futureResponse` while keeping the existing `ClaudeResponse` shape on resolution)
- [x] 3.2 Update the for-await loop in `askClaude` to operate against the handle's underlying SDK message stream and to map the first `result` to `futureResponse`
- [x] 3.3 Reset `ClaudeMessageParser.result` (or instantiate a new parser) per turn, even though only one turn is observed today — keeps the assumption local to one turn instead of per-instance lifetime
- [x] 3.4 Add unit tests covering: successful run resolves `futureResponse`, abort via `stop()` resolves with `cancelled: true`, `sendUpdate` reaches the SDK before first `result`, `sendUpdate` after first `result` rejects

## 4. Adapt executeChange (worker path)

- [x] 4.1 Change `src/changes/execution.ts` `executeChange` to return a `ClaudeRunHandle` (mapping the worker's final state into `ExecutionResult` on `futureResponse`)
- [x] 4.2 Move the existing for-await loop's body into the handle's worker; preserve worker-specific behavior (`lastProgressMessage`, `finalText` accumulation, log lines, heartbeat, `onProgress` callbacks)
- [x] 4.3 Distinguish stop reasons: when `handle.stop(reason)` is invoked with a user-cancellation reason vs a timeout reason, set `ExecutionResult` accordingly (preserve current "Execution cancelled" vs timeout messages)
- [x] 4.4 Add unit tests for `executeChange`: handle return shape, `sendUpdate` injects a follow-up that the model receives on the next turn boundary (mock SDK), `stop()` produces a cancellation `ExecutionResult`

## 5. Workflow integration (worker)

- [x] 5.1 In `src/changes/workflow.ts`, replace `activeChange.abortController` with `activeChange.handle: ClaudeRunHandle | undefined`
- [x] 5.2 Update `startChangeWorkflow` to store the handle returned by `executeChange` and clear it in the `finally` block
- [x] 5.3 Update `handleFollowUp` to do the same for review/update/merge/close paths
- [x] 5.4 Update `cancel_worker_run` MCP tool (`src/tools/...`) to call `activeChange.handle.stop(reason)` instead of `abortController.abort()`
- [x] 5.5 Update worker stop-reaction and inline-stop paths in `stopPipeline` to call `activeChange.handle.stop(reason)`
- [x] 5.6 Update tests for the worker stop paths

## 6. Slack handler routing (Q&A)

- [x] 6.1 In `src/slack/handlers/core.ts` `processMessage`, before constructing a fresh run, look up the active-runs registry for `(channelId, threadTs)`. If a handle exists, call `handle.sendUpdate(text)` and return; on rejection, fall through to the existing fresh-spawn path
- [x] 6.2 Wire the fresh-spawn path so the new `ClaudeRunHandle` registers itself in the active-runs registry under `(channelId, threadTs)`
- [x] 6.3 Remove the `withInFlightTracking` wrapper — the handle self-registers and self-deregisters
- [x] 6.4 Make `executeAndDeliver` await `handle.futureResponse` where it currently awaits `askClaude` directly
- [x] 6.5 Update tests in `core.test.ts` and `handlerResponse.test.ts` to cover the registry consultation, sendUpdate routing, and fall-through on rejection

## 7. Slack handler routing (other entry points)

- [x] 7.1 In `src/slack/handlers/autoRespond.ts`, remove the `processingThreads` Set; route through the active-runs registry; call `handle.sendUpdate(text)` on hit
- [x] 7.2 In `src/slack/handlers/mention.ts`, consult the registry before spawning; route to `sendUpdate` on hit
- [x] 7.3 In `src/slack/handlers/dmActions.ts`, same routing logic
- [x] 7.4 In `src/slack/handlers/newQuery.ts` and any other entry path that constructs a session, same routing logic
- [x] 7.5 Update tests in `autoRespond.test.ts`, `mention.test.ts`, `dmActions.test.ts`, `newQuery.test.ts` to cover the new routing

## 8. messageChanged and stopPipeline

- [x] 8.1 In `src/slack/handlers/messageChanged.ts`, replace `getInFlightRequest` + `abortController.abort()` + `deregister` with `activeRuns.getByThread(channelId, threadTs)?.stop()`
- [x] 8.2 Preserve the existing edit-text restart logic — call `handle.stop()` then `processMessage()` with the new text exactly as today
- [x] 8.3 Rewrite `src/slack/stopPipeline.ts` to look up the active-runs registry and call `handle.stop(reason)` on the registered handle. Worker-side stop continues to set `cancelledBy` and lifecycle status as today
- [x] 8.4 Update tests in `messageChanged.test.ts` and any `stopPipeline.test.ts`

## 9. Remove the prior in-flight registry

- [x] 9.1 Delete `src/slack/inFlightRequests.ts` once all callers have migrated to the active-runs registry
- [x] 9.2 Verify no remaining imports of `registerInFlightRequest`, `deregisterInFlightRequest`, `getInFlightRequest`, or `findInFlightByThread` exist
- [x] 9.3 Remove related types and any dead test fixtures

## 10. Verification

- [x] 10.1 Run `npm run build` to confirm TypeScript compiles end-to-end
- [x] 10.2 Run `npm run test` and confirm all suites pass
- [x] 10.3 Run `openspec validate add-claude-run-handle --strict` and address any validation errors
- [x] 10.4 Manually verify (via local dev or scripted scenario): two fast successive @mentions in the same thread result in one streamer that handles both pieces of context (the second message is delivered via `sendUpdate`); a stop reaction during a run aborts cleanly; a worker mid-run accepts a follow-up message via `sendUpdate`
