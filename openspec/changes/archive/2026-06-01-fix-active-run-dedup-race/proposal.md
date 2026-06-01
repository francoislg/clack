## Why

The active-runs registry already specifies an **Atomic Slot Claim** requirement: two concurrent triggers on the same `(channelId, threadTs)` must never both spawn a fresh Claude run. The implementation violates this. Slack handlers *consult* the registry synchronously at the top of `processMessage` (`getActiveRunForChannelMessage`, `core.ts:482`) but the slot is not *claimed* until `registerActiveRun` runs deep inside `askClaude` (`index.ts:486`) — after `setupSession`, `getClaudeOptions`, `getUserInfo`, and `streamer.start()`, a ~500ms–2s window of 4–6 awaited Slack/disk round-trips. Two DM messages arriving on one thread inside that window both observe an empty slot and each spawn a run *and* a "thinking" streamer. Worse, when the late `registerActiveRun` finds the slot already taken by the racing sibling, `askClaude` logs "proceeding without registration" and runs the duplicate **untracked** (`index.ts:488`) — a leaked run whose streamer card stays open and which the stop pipeline can never reach. Users observe multiple simultaneous "thinking" indicators and a second response starting before the first finishes. The non-atomicity was introduced by the streamer/`ClaudeRunHandle` refactor (`c60d080`), which moved registration inside `askClaude`.

## What Changes

- Make the "consult-then-spawn" decision genuinely atomic by serializing it per `(channelId, threadTs)`: wrap the check-then-`{sendUpdate | spawn}` block in `processMessage` (`core.ts:474–523`) in a per-thread async mutex held across the handler's async setup, so a concurrent message on the same thread cannot enter the spawn path until the first invocation has either queued onto the existing run or registered its new one.
- Make `registerActiveRun` failure **non-silent**: in `askClaude` (`index.ts:486–492`), a run that cannot claim its slot must NOT proceed untracked — it aborts (or routes into the owning run) instead of running as a leaked, un-cancellable duplicate.
- Audit the other handler entry points that spawn runs (`choice`, `followup`, `retry`, change-thread follow-ups) to confirm none depend on the current "proceed without registration" behavior before it is made fatal.
- Tighten the `active-runs-registry` spec to state that the slot claim must be effected with no awaited work between the registry consult and the claim (or otherwise serialized per thread), and that streamer/delivery setup must not begin until the invocation owns the slot — closing the loophole the current "set-if-absent serializes construction" wording leaves open.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `active-runs-registry`: strengthen the **Atomic Slot Claim** and **Self-Registration** requirements so atomicity does not rely on construction-time set-if-absent that the handler reaches only after a long await chain; forbid awaited work between consult and claim (or require per-thread serialization), make an unclaimable slot fatal to the duplicate run rather than running it untracked, and require streamer/delivery setup to follow slot ownership.

## Impact

- **Code**: `src/slack/handlers/core.ts` (`processMessage` dedup block), `src/slack/activeRuns.ts` (per-thread serialization primitive), `src/claude/index.ts` (`askClaude` register-or-bail at `:486–492`). Audit-only review of `src/slack/handlers/{choice,followup,retry,changeAction,changeThreadActions}.ts` and `src/slack/handlers/handlerResponse.ts` (streamer start ordering, `:168`).
- **Behavior**: eliminates duplicate concurrent runs / multiple "thinking" streamers on one thread and the associated leaked, un-cancellable runs. Messages on the same thread are serialized (intended); cross-thread concurrency is unaffected.
- **Risk**: low — no data-format or config changes; the serialization is in-memory and per-thread. Main risk is the streamer-ordering / register-or-bail audit surfacing a path that legitimately ran unregistered.
