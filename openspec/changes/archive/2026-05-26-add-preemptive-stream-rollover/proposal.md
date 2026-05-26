## Why

Slack's chatStream expires after approximately 5 minutes regardless of keepalive activity (empirically observed: a 7-minute `run_scheduled_message_now` invocation reliably blows past the TTL even with title decorations + dot-trail details firing every 15 seconds). Today's `rollover()` only fires *after* an append failure, which means the user sees the prior block freeze, a noisy "Continuing previous stream…" cue, and a delayed continuation. For any tool that synchronously blocks the outer Claude turn for >5 minutes, the streaming UX degrades to "the bot looks dead, then snaps back to life on a new block." Rotating the chatStream *before* Slack kills it avoids the failure path entirely.

## What Changes

- Add a **preemptive rollover timer** to `SlackStreamer` that fires `rollover()` proactively at ~4 minutes after the current block opened (margin under Slack's ~5-minute TTL).
- Track preemptive rollovers separately from reactive ones. **Preemptive rollovers are NOT capped at `MAX_ROLLOVERS=2`** — they're expected to happen regularly on long jobs. Reactive (failure-driven) rollovers keep their existing cap.
- **The new block's continuation task is not grouped with the previous block's open group.** When rollover (preemptive OR reactive) fires while an `openGroup` is active, the new block opens with a fresh continuation task; the old group does not carry over and does not fold into anything on the new block.
- Suppress the "Continuing previous stream…" cue on preemptive rollovers — it implies something went wrong. Use a quieter title (or just resume the existing thinking lifecycle) since the rotation is planned.
- Fix the `THINKING_TASK_ID` replay clobber identified in the prior exploration: when `append()` rolls over after a failure, drop chunks targeting the thinking task id from the replay so the continuation title isn't overwritten by the original "Acknowledged" / keepalive-idle payload.
- Snapshot in-flight tasks before clearing rollover state and **re-emit them on the new block** so the eventual `tool_end` lands on a live task card instead of being silently dropped. The frozen "in_progress" task on the prior block is marked `complete` before rotation to avoid the visual of a forever-pending card.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `streaming-responses`: rollover semantics gain a preemptive trigger path; the continuation-cue + group-handoff + in-flight-task re-emission requirements all change.

## Impact

- **Code**:
  - `src/streaming/slackStreamer.ts` — preemptive timer, separate counters, in-flight-task snapshot/re-emit, THINKING_TASK_ID replay filter, group-handoff change
  - `src/streaming/slackStreamer.test.ts` — new tests for preemptive rotation, in-flight re-emit, replay filter, group non-fold across blocks
- **Specs**:
  - `openspec/specs/streaming-responses/spec.md` — Stream Rollover requirement updates (preemptive trigger, separate counter, group-handoff scenario, replay-filter scenario, in-flight re-emit scenario)
- **No changes to**: handler call sites (`handlerResponse.ts`), tool implementations, `QueryToolContext`. The rotation is internal to `SlackStreamer`.
- **Behavior change for users**: long-running jobs now produce N blocks (one per ~4-minute window) instead of 1 block + N reactive-rollover blocks. The block boundary becomes a regular cadence on long jobs, not a panic signal.
