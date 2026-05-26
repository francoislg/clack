## 1. Streamer-internal plumbing

- [x] 1.1 Rename `MAX_ROLLOVERS` to `MAX_REACTIVE_ROLLOVERS` in `src/streaming/slackStreamer.ts`; update all references in the file and its tests
- [x] 1.2 Replace the single `rolloverCount` field with two fields: `reactiveRolloverCount` and `preemptiveRolloverCount`; initialize both to 0
- [x] 1.3 Add `MAX_PREEMPTIVE_ROLLOVERS = 20` as a private static readonly constant
- [x] 1.4 Add `PREEMPTIVE_ROLLOVER_INTERVAL_MS = 4 * 60 * 1000` (240,000) as a private static readonly constant
- [x] 1.5 Add a `preemptiveTimer: ReturnType<typeof setTimeout> | null` instance field, initialized to `null`
- [x] 1.6 Add a `rolloverInFlight: boolean` instance field, initialized to `false`, used to serialize concurrent rollover attempts
- [x] 1.7 Update `streamDiagnostics()` to return both counters (replace the single `rolloverCount` field in its return shape with `reactiveRolloverCount` and `preemptiveRolloverCount`)

## 2. THINKING_TASK_ID replay filter

- [x] 2.1 In `append()`'s catch handler, after a successful `rollover()`, filter the chunks array to drop any entry whose `id === THINKING_TASK_ID` before the retry
- [x] 2.2 If the filtered chunks array is empty, skip the retry entirely (the rollover's own continuation post is sufficient)
- [x] 2.3 Add a test verifying that when `start()`'s initial "Acknowledged" append fails and rolls over, the new block ends up showing "Continuing previous stream…" (NOT "Acknowledged")
- [x] 2.4 Add a test verifying that when a pre-finalize keepalive idle ping fails and rolls over, the new block ends up showing "Continuing previous stream…" (NOT "Acknowledged")

## 3. In-flight task snapshot and re-emit on rollover

- [x] 3.1 Extract a private method `snapshotInFlightTasks()` that returns an array of `{ taskId, slackId, label, isGroup }` derived from `activeTasks` + `taskLabels`, called BEFORE the existing state-clearing in `rollover()`
- [x] 3.2 Add a private method `markPriorBlockInFlightComplete(snapshot)` that fires one final `task_update` per snapshotted task with `status: "complete"` on the prior chatStreamer (best-effort; failures are swallowed because the block is about to be abandoned)
- [x] 3.3 Add a private method `reEmitInFlightTasksOnNewBlock(snapshot)` that, after the rollover's continuation cue lands on the new stream, emits one `task_update` per snapshotted task with `status: "in_progress"` and the original label, repopulating `taskSlack`, `taskLabels`, and `activeTasks` (with `startedAt = now`, `tickCount: 0`, `isGroup: false` — re-emitted tasks are always standalone, per the no-group-fold-across-rollover requirement)
- [x] 3.3.1 Per design Risk #4 mitigation: immediately after re-emit, fire a keepalive-equivalent decoration on each re-emitted task (title with `⏱ 0s` or similar, single `\n .` detail) so the new block doesn't appear empty for ~15s waiting on the next keepalive tick
- [x] 3.4 Wire these three methods into the existing `rollover()` flow in the correct order: snapshot → mark prior complete → clear collections → open new stream → post continuation cue → re-emit on new block
- [x] 3.5 Add a test that drives a `tool_start` followed by a rollover (reactive), confirms the prior block received a `complete` chunk for the in-flight task, and confirms the new block received an `in_progress` chunk for the same `taskId` with the same label
- [x] 3.6 Add a test that drives a `tool_start` → rollover → `tool_end` for the same task, and verifies the `tool_end` lands on the NEW block (not silently dropped)
- [x] 3.7 Add a test that drives a grouped tool fold (2-3 tools sharing a group key) → rollover → confirms each tool re-emerges as a STANDALONE card on the new block, with no group title or `(N)` counter

## 4. Preemptive rollover trigger

- [x] 4.1 Add a private method `schedulePreemptiveRollover()` that clears any existing `preemptiveTimer`, then sets a new `setTimeout` at `PREEMPTIVE_ROLLOVER_INTERVAL_MS`; the callback checks `failed`/`stopped`/`preemptiveRolloverCount >= MAX_PREEMPTIVE_ROLLOVERS` before invoking `rollover({ preemptive: true })`; the timer must call `.unref()`
- [x] 4.2 Add a private method `clearPreemptiveTimer()` that nulls `preemptiveTimer` after `clearTimeout`
- [x] 4.3 Call `schedulePreemptiveRollover()` at the end of `start()` after `startKeepalive()` (only when start succeeded)
- [x] 4.4 Call `schedulePreemptiveRollover()` at the end of every successful `rollover()` (so each new block schedules the next rotation)
- [x] 4.5 Call `clearPreemptiveTimer()` in `stop()`, `stopKeepalive()`'s failure paths, and on `stopped_by_user` — anywhere the streamer enters a terminal state
- [x] 4.6 Add a test that uses fake timers to advance past `PREEMPTIVE_ROLLOVER_INTERVAL_MS` and verifies a rollover fires, `preemptiveRolloverCount === 1`, and a new block opens
- [x] 4.7 Add a test that drives `MAX_PREEMPTIVE_ROLLOVERS` preemptive rotations and verifies the (N+1)th tick does NOT fire another rollover
- [x] 4.8 Add a test that verifies the preemptive timer is cleared on `stop()` (no rollover fires after stop, even if fake-advanced past the interval)

## 5. Preemptive rollover behavior differences from reactive

- [x] 5.1 Modify `rollover()` to accept an options object: `{ preemptive: boolean }` (default `false` for backward compatibility with the reactive call site in `append()`'s catch)
- [x] 5.2 When `preemptive: true`, post the appropriate baseline title for the thinking task id — `thinkingTitle` if `thinkingFinalized` was true on the prior block, otherwise `t("streamer.acknowledged")` — NOT the "Continuing previous stream…" cue
- [x] 5.3 When `preemptive: true`, PRESERVE `thinkingFinalized` across the rollover (do NOT reset to `false`). For `preemptive: false` (reactive), keep the existing behavior of resetting `thinkingFinalized` to `false` — this contrast is intentional
- [x] 5.4 When `preemptive: true`, increment `preemptiveRolloverCount`; when `preemptive: false`, increment `reactiveRolloverCount`
- [x] 5.5 Add a test verifying that on preemptive rollover, the new block's first chunk uses `thinkingTitle` (when `thinkingFinalized` was true) and NOT `"Continuing previous stream…"`
- [x] 5.6 Add a test verifying `thinkingFinalized` is preserved across preemptive rollover (after rotation, a keepalive idle ping should use `thinkingTitle`, not "Acknowledged")

## 6. Rollover serialization (rolloverInFlight)

- [x] 6.1 At the top of `rollover()`, check `rolloverInFlight`; if `true`, return `false` immediately without attempting another open
- [x] 6.2 Set `rolloverInFlight = true` before opening the new chatStream
- [x] 6.3 Set `rolloverInFlight = false` in the success path AND in the catch (use try/finally)
- [x] 6.4 Add a test that simulates two concurrent failures racing against a preemptive timer and verifies only ONE `chat.startStream` call lands

## 7. Group-fold non-crossing across rollover

- [x] 7.1 Add a test (covering BOTH reactive and preemptive rollover paths) that confirms `openGroup` is null on the new block when the prior block had an active group — a regression gate so future state-carryover optimizations don't accidentally leak group state across rollover
- [x] 7.2 Add a test (covering BOTH reactive and preemptive paths) that drives 3 same-group tools → rollover → 1 more same-group tool, and verifies the post-rollover tool starts a FRESH group (count=1) rather than folding into the prior group's count

## 8. Diagnostics + logging

- [x] 8.1 Update every `logger.warn(..., this.streamDiagnostics())` call site to ensure both counters are included in the logged object
- [x] 8.2 Update the existing "Known stream expiry logged as warning with diagnostics" test (if it asserts `rolloverCount`) to assert both counters
- [x] 8.3 Add a test verifying that when both reactive and preemptive rollovers have occurred, `streamDiagnostics()` returns both counts correctly

## 9. Update callers + downstream code

- [x] 9.1 Sweep the repo for any remaining references to `rolloverCount` outside of the logger.warn / diagnostics paths covered by 8.1-8.3 (e.g., test assertions in other files, type declarations re-exporting diagnostic shapes, plugin code touching streamer internals) and update them to use both `reactiveRolloverCount` and `preemptiveRolloverCount` as appropriate
- [x] 9.2 If `handlerResponse.ts` or other callers check `streamer.getRolloverCount()` or similar, update those usages
- [x] 9.3 Run `npx tsc` to verify type-checks pass after the renames and field changes

## 10. Verification

- [x] 10.1 Run `npm test -- src/streaming/slackStreamer.test.ts` and verify all new and existing tests pass
- [x] 10.2 Run `npx oxlint src/streaming/` and confirm no lint errors
- [x] 10.3 Run `npx oxfmt src/streaming/` and confirm formatting is clean
- [x] 10.4 Run the full `npm test` suite to catch any cross-file regressions (rollover changes touch the handlerResponse test paths)
- [x] 10.5 Run `npx tsc` to verify the whole project type-checks
- [x] 10.6 Manual sanity check in dev: trigger `run_scheduled_message_now` against a slow scheduled job (>4 minutes) and confirm a preemptive rotation happens at the 4-minute mark, the new block continues the lifecycle smoothly without the "Continuing previous stream…" cue, and the final answer lands correctly
