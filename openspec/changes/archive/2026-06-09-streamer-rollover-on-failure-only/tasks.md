## 1. Remove preemptive rollover

- [x] 1.1 Delete `PREEMPTIVE_ROLLOVER_INTERVAL_MS` and `MAX_PREEMPTIVE_ROLLOVERS` constants from `SlackStreamer`
- [x] 1.2 Delete `preemptiveTimer` field, `preemptiveRolloverCount` field, `schedulePreemptiveRollover()`, and `clearPreemptiveTimer()`
- [x] 1.3 Remove `schedulePreemptiveRollover()` calls from `start()` and `rollover()`
- [x] 1.4 Remove the `clearPreemptiveTimer()` calls from `stop()` and the failed-state paths in `append()`
- [x] 1.5 Collapse `rollover()` to a single (reactive) variant: remove the `preemptive` parameter and its branches (continuation title, `thinkingFinalized` preservation, count increment); always use the `"Continuing previous stream…"` cue and reset `thinkingFinalized`
- [x] 1.6 Drop `preemptiveRolloverCount` from `streamDiagnostics()`

## 2. Make reactive rollover unbounded

- [x] 2.1 Delete the `MAX_REACTIVE_ROLLOVERS` constant
- [x] 2.2 Remove the `reactiveRolloverCount < MAX_REACTIVE_ROLLOVERS` cap comparison in `append()`'s recoverable-failure branch
- [x] 2.3 Keep `reactiveRolloverCount` as a diagnostics-only counter, incremented at the same point as today (after the continuation-cue append succeeds inside `rollover()`), never compared against a cap
- [x] 2.4 Ensure the only remaining paths to failed state are: non-recoverable code, `stopped_by_user`, and a failed new-stream open in `rollover()`; update the `append()` recoverable-branch comment to say so (a count-based give-up must no longer exist)

## 3. Add the stream-generation guard

- [x] 3.1 Add a `private generation = 0` field; increment it in both `start()` and `rollover()` immediately after the `await openChatStream()` call returns and `this.chatStreamer` has been reassigned to the new stream — before the first append on it. (Ordering matters: any append that later observes the new generation must also observe the new `this.chatStreamer`.)
- [x] 3.2 In `append()`, snapshot `const gen = this.generation` before the `chatStreamer.append` call
- [x] 3.3 In the recoverable-failure branch, if `this.generation !== gen`, the stream was already rolled over by a sibling append: replay the chunks (minus `THINKING_TASK_ID`) onto the now-current `this.chatStreamer` (which already points at the new stream per 3.1) instead of rolling over; if the filtered replay list is empty, return without appending and without error; do not increment `reactiveRolloverCount`
- [x] 3.4 If `this.generation === gen`, this append is the first to discover the dead stream: perform exactly one rollover then replay, as today
- [x] 3.5 Retain the existing `rolloverInFlight` mutex and document its split role in an `append()` comment: the mutex serializes the *concurrent* window (a sibling failing while the rollover's `openChatStream` is still awaiting), and the generation guard (3.3) covers the *post-completion* window (a stale append rejecting after the rollover already finished). Together they guarantee a stale append never opens a second stream and never replays onto a dead handle.

## 4. Tests

- [x] 4.1 Remove preemptive-rollover tests (timer scheduling, quiet cue, cap-at-20, idle-fire, preemptive/reactive non-race) from `slackStreamer.test.ts`
- [x] 4.2 Remove the reactive-cap tests (cap exhausted → fallback, cap independence) and the diagnostics test asserting `preemptiveRolloverCount`. Replace the cap-exhaustion test with one asserting failed state is reached ONLY on a failed new-stream open (not on any count); keep a test that rollover+retry success continues without failed state
- [x] 4.3 Add a test: two concurrent in-flight appends fail with a recoverable code on one stream → assert exactly one `chatStream()` open happens, `getAllMessageTss()` gains exactly one block, and only one rollover is counted (generation guard collapses the burst)
- [x] 4.4 Add a test: after a rollover opens block 2, a stale append from the old generation fails recoverably → assert its chunks land on block 2's (new/live) streamer handle, not block 1's, and `reactiveRolloverCount` does not increment
- [x] 4.5 Add a test: N (≥3) sequential `message_not_in_streaming_state` failures each trigger a rollover (unbounded) → `getAllMessageTss()` length is N+1 and `reactiveRolloverCount === N`, no failed state
- [x] 4.6 Update `getAllMessageTss` tests that assert the `1 ≤ N ≤ MAX_ROLLOVERS` bound to the unbounded form — N/A: no existing test asserted that bound; the new unbounded test (4.5) covers N+1 blocks past the old cap

## 5. Verify

- [x] 5.1 `npx tsc` clean, then grep `src/` for `MAX_REACTIVE_ROLLOVERS`, `MAX_PREEMPTIVE_ROLLOVERS`, `PREEMPTIVE_ROLLOVER_INTERVAL_MS`, `preemptiveRolloverCount`, `preemptiveTimer`, `schedulePreemptiveRollover`, `clearPreemptiveTimer` — confirm zero references in live code (only deleted tests/comments may remain, and those should be gone too)
- [x] 5.2 `npx oxlint` and `npx oxfmt --check` on changed files
- [x] 5.3 `npm test` green
- [x] 5.4 `openspec validate streamer-rollover-on-failure-only --strict` passes
