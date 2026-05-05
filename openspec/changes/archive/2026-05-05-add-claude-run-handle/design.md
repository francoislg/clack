## Context

Today, every Slack triggering message produces an isolated `clackSession` invocation:

```
Slack msg → askClaude() → clackSession({ prompt: string })
                            └─► query() in string-prompt mode
                                 └─► for-await loop, exits on first `result`
                                      └─► returns ClaudeResponse
```

Three side-effects of this shape are problematic:

1. **Two messages, two Queries.** A second message arriving in the same thread spawns a parallel Query that resumes from the same `sdkSessionId`. They race; the SDK has no concept of "join an existing run."
2. **No mid-flight injection.** Once a worker-mode change is executing, the only way for the user to add context is to wait, kill it, and start over. The `AbortController` is the only handle.
3. **Coordination scattered.** `inFlightRequests`, `withInFlightTracking`, `processingThreads`, `activeChange.abortController`, `messageChanged`'s abort+restart, and `stopPipeline`'s thread scan all exist because there is no single object that represents "the run currently happening for this thread."

The Claude Agent SDK already supports the primitive we need: `query({ prompt: AsyncIterable<SDKUserMessage> })` — _streaming-input mode_ — which lets us push more user messages into a Query after it starts. `query.interrupt()`, `setPermissionMode()`, and `setModel()` are also documented as available only in this mode, so switching is strictly an upgrade for the existing `attach_integration` machinery.

## Goals / Non-Goals

**Goals:**

- A Slack message that lands while a run is in flight on the same thread becomes a queued user message on that run, not a parallel session.
- Worker mode supports the same: a follow-up message in a change thread is delivered to the running worker as the next user input.
- The streamer flow, per-Slack-message delivery semantics, in-flight cancellation, and `messageChanged` abort+restart behavior all preserve their current observable behavior at the Slack level.
- The number of concurrent Queries per thread becomes exactly 0 or 1 (was: 0, 1, or N depending on race timing).
- `stopPipeline`, `withInFlightTracking`, `inFlightRequests`, and `processingThreads` collapse into one registry-of-handles whose lookup is cheap and whose semantics are obvious.

**Non-Goals:**

- Long-lived "always-on" Queries that persist across thread idle periods. A handle exists only for the duration of one `result`. Once the result is delivered, the handle settles and a future message starts a fresh `clackSession`.
- Multi-turn rendering within one streamer. One run = one streamer = one Slack message, exactly as today.
- Interrupt semantics for `sendUpdate` (i.e., abandoning the current model output to redo the answer with new context). A separate `amendContext(text)` method may come later; this proposal stays with non-interrupting queue-after-current-turn semantics.
- Changes to `clackQuery` and its 5 fire-and-forget call sites.
- Changes to session persistence, role gating, the MCP catalog, or the streamer API.

## Decisions

### 1. Return a handle, not a Promise

`clackSession`, `askClaude`, and `executeChange` return `ClaudeRunHandle` synchronously (the function itself is no longer `async`; only `futureResponse` is awaitable):

```ts
interface ClaudeRunHandle {
  sendUpdate(text: string): Promise<void>;
  stop(reason?: string): Promise<void>;
  readonly futureResponse: Promise<ClaudeResponse>;
  readonly status: "running" | "settled" | "stopped";
}
```

**Why a synchronous return.** If the function is `async` and returns the handle only after `await`, the caller cannot push updates during the time before the first `result` arrives — which is exactly the window we care about. Synchronous return + a `Promise<ClaudeResponse>` field is the only shape that makes "send updates while the answer is being computed" expressible from one async context.

**Alternatives considered:**

- _Yielding turns through an async generator (`for await (const turn of run)`)_: too disruptive — every call site shifts to a multi-turn loop. Doesn't match the "one Slack message, one answer" model we want to keep.
- _Callback-based API (`askClaude({..., onResult, onUpdate})`)_: pushes inversion-of-control onto every caller; harder to compose with the existing for-await streamer code.
- _Return a tuple `[sendUpdate, futureResponse]`_: works but loses the affordance for `stop`, `status`, and future methods. An object with named fields scales better.

### 2. First-result-wins lifecycle (Option A)

The handle's `futureResponse` resolves with the first `result` message the SDK emits. At that moment:

1. The internal input stream is closed (no more `SDKUserMessage` will ever be pushed).
2. `status` flips from `running` to `settled`.
3. Subsequent `sendUpdate` calls reject with `"run already settled"`.

This preserves the 1:1 mapping between Slack triggering messages and assistant responses. A pushed update lands on the run only if it arrives before the first `result`; otherwise the caller must spawn a fresh `clackSession` against the persisted `sdkSessionId` (the existing path).

**Why not idle-close (Option B) or explicit-close (Option C):**

- Idle-close requires a timer + a race window where `sendUpdate` and "stream closed" can interleave. Too much complexity for the use case.
- Explicit-close pushes a `done()` decision onto every caller. The current code has no natural place to put it — handlers are stateless per-message.
- First-result-wins matches the existing function semantics exactly: the result is "the answer to this run," and "this run" is the duration of one model turn. No timer, no caller bookkeeping.

The cost: a fast user typing back-to-back produces some races where the second message lands too late and spawns a fresh resume. That is **strictly better than today**, where it always spawns a fresh resume (or gets dropped). We are not trying to capture every collision — only the meaningful window between "user sent" and "Claude finished thinking."

### 3. `sendUpdate` is non-interrupting

`sendUpdate(text)` pushes a new `SDKUserMessage` onto the input stream's internal queue. The SDK delivers it to the model after the current turn completes. Because we close the input stream on first `result`, a queued message that has not been consumed when the result arrives is **not delivered**; this manifests to the caller as the result completing without the queued context.

We accept this. The alternative (interrupt + replay) is a separate semantic: it abandons the answer the model is producing, which is not what "I forgot to mention…" usually wants. Future work can add `amendContext(text)` that calls `query.interrupt()` first; that primitive is documented and available in streaming-input mode.

### 4. Handle owns the registry slot

The active-runs registry is a `Map<key, ClaudeRunHandle>` where `key` is either a thread key (`channelId:threadTs`) or a per-user DM key (`dm:channelId:userId`). Each handle is registered under all keys that apply to its conversation; for DMs that means both the thread key (where each new top-level DM has its own ts) and the per-user DM key (stable across the whole DM channel for that user). The handle's constructor inserts itself; settling or stopping removes every key it owns.

Slack handlers consult the registry via:

```ts
const existing = activeRuns.getForChannelMessage(channelId, threadTs, userId);
if (existing) {
  try {
    await existing.sendUpdate(text);
    return; // success — no new run needed
  } catch {
    // settled/stopped concurrently; fall through to spawn fresh
  }
}
spawnFreshRun(...);
```

The `try/catch` covers the race where the run settles between `get` and `sendUpdate`. The only invariant we need is "a settled handle never accepts a new push," which is enforced internally by the handle.

**Invariant: at most one handle per registered key.** If a fresh run is spawned while one already exists, that is a bug — the handler's job is to consult the registry first.

### 5. Per-message metadata moves off the registry

Today's `inFlightRequests` map carries `triggerType`, `messageTs`, `sessionId`, etc. — metadata that `messageChanged` and `stopPipeline` use. With a thread-keyed registry, that metadata moves to the session (which is the source of truth for `triggerType`) and to the `DeliveryContext` (which is per-Slack-message anyway). The handle itself only needs the `AbortController` (which it owns internally).

`messageChanged.ts` no longer keys by `messageTs`. It looks up via `getForChannelMessage(channelId, threadTs, userId)` and pushes the edited text into the live run via `handle.sendUpdate`. Edits to the bot's own messages are skipped to avoid runaway loops while the streamer updates its placeholder.

### 6. Resume-fallback retains the first message

`clackSession`'s resume-fallback path (today: rebuild the Query with the same `prompt: string` when the SDK reports "no conversation found") needs to replay the original `SDKUserMessage` into the fresh Query's input stream. The handle holds a reference to the first message until the SDK has emitted a non-error message; on fallback, that reference is pushed into the new input stream as the first item, and any items queued via `sendUpdate` between the failed start and the fallback are pushed in order. Total cost: one retained reference and a 5-line replay loop.

### 7. Worker mode integration

`executeChange` returns the handle. `workflow.ts` stores it on `activeChange` (replacing `activeChange.abortController`). Stop becomes `activeChange.handle.stop()`. Follow-up messages from Slack on the change thread are routed by the existing thread-routing in handlers; if the handler finds the worker's handle in the active-runs registry, it calls `sendUpdate` on it. The worker sees the message as a queued `SDKUserMessage` and reads it on its next "ready for input" boundary (typically after the in-flight tool call finishes). No special "worker context injection" tool is needed — it's just the next user message.

The existing `activeChange.abortController` field is removed. Anything that calls `abort()` on it now calls `handle.stop()`.

### 8. Streaming-input mode is universal for `clackSession`

We do not offer a "string-prompt mode" toggle on `clackSession`. Every multi-turn run uses streaming input; the initial prompt is the first item pushed. This:

- Removes the dual-mode branching in the wrapper.
- Makes `setMcpServers` (already used by `attach_integration`) and the rest of the streaming-input-only control methods (`setPermissionMode`, `setModel`, `setMaxThinkingTokens`) uniformly available.
- Has no effect on `clackQuery` — it stays string-prompt as today.

## Risks / Trade-offs

| Risk                                                                                                                    | Mitigation                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`ClaudeMessageParser.result` is single-valued and held as instance state** — multi-result observation could break it. | First-result-wins means we close after one result anyway. Instance unchanged; behavior unchanged.                                                                                                                                                                                                           |
| **Resume-fallback replay path is more complex than today's string rebuild.**                                            | Single retained reference + a small loop; covered by a unit test that simulates the "no conversation found" error and asserts the replay.                                                                                                                                                                   |
| **A queued `sendUpdate` arrives but the input stream is closed before the SDK reads it.**                               | This is the "lost update" case. `sendUpdate` rejects synchronously when `status !== "running"`. After resolution, the caller spawns a fresh run with the would-be-pushed text as the prompt — which is exactly what happens today for any post-completion message. No regression.                           |
| **Two callers race to spawn a run for an empty thread slot.**                                                           | Active-runs registry uses a synchronous "set if absent" check before constructing the run. The second caller sees the registered handle and routes to `sendUpdate`.                                                                                                                                         |
| **`messageChanged` for a top-level non-threaded trigger.**                                                              | Today the registry key is `messageTs`. New key is `threadTs`, which for top-level triggers equals `messageTs`. Lookup result is identical.                                                                                                                                                                  |
| **Worker turns are long; `sendUpdate` may sit queued for minutes.**                                                     | This is the expected behavior — "tell the worker something on its next available boundary." Slack handler posts a small "queued for worker" indicator if the queue depth > 0 when the user sends.                                                                                                           |
| **Interaction with `attach_integration` mid-session.**                                                                  | Already uses `onQuery → mcpManager.bind(query.setMcpServers)`. Streaming-input mode does not change this binding; the upgrade is invisible to the tool.                                                                                                                                                     |
| **Memory leak: handle outlives its run if a code path forgets to settle.**                                              | The `for-await` loop in `askClaude` / `executeChange` is wrapped in a `try/finally` that calls a `settle()` method on the handle, which removes the registry slot. Tests assert the slot is empty after a normal completion, an error, and an abort.                                                        |
| **Test surface area.**                                                                                                  | Unit tests cover: (a) `sendUpdate` before first result reaches the model, (b) `sendUpdate` after first result rejects, (c) `stop()` mid-run aborts and clears the slot, (d) resume-fallback replays the first message, (e) two parallel handler invocations result in one handle and one `sendUpdate` call. |

## Migration Plan

This is an internal refactor. No on-disk format changes; no config changes; no Slack UX changes (other than the now-correct handling of follow-up messages, which is the point). Sequence:

1. Land `ClaudeRunHandle` type + the new active-runs registry (no callers yet).
2. Convert `clackSession` to streaming-input mode and return a handle. Adapt `askClaude` and `executeChange`. Existing call sites await `handle.futureResponse` — diff is mostly mechanical.
3. Remove `inFlightRequests.ts`, `withInFlightTracking`, `processingThreads`, `activeChange.abortController`. Wire `messageChanged` and `stopPipeline` to the new registry.
4. Update Slack handlers (`mention`, `dmActions`, `autoRespond`, `newQuery`) to consult the registry before spawning.
5. Update tests; add new ones for the handle and registry.

No staged rollout needed — the change is observable only in the "second message in the same thread mid-run" case, which today is broken (race or drop). Rollback is a git revert.

## Open Questions

- Should `sendUpdate` on the worker emit a Slack indicator (e.g., a 💬 reaction on the user's message) so they know it landed in the queue? Defer to implementation — easy to add on either side.
- Should the registry expose its size for debugging via the home tab? Probably yes; trivial. Not required for correctness.
- Naming: `sendUpdate` vs `enqueue` vs `pushMessage`. `sendUpdate` matches the user's mental model from Slack (sending a message to an ongoing conversation). Keep it.
