## Context

Today's `SlackStreamer.rollover()` (added in commit `5ab4eaa`) is purely reactive: it fires only when an `append()` call throws with `message_not_in_streaming_state` or `message_not_found`. This works, but it means every long-running tool call (>~5 minutes) goes through the failure path with its associated UX cost:

- The prior block freezes at whatever state the keepalive last decorated.
- The user sees a "Continuing previous stream…" cue, which reads like an apology for an error.
- Tasks in the open group on the prior block are abandoned mid-flight; their eventual `tool_end` is silently dropped.
- The `MAX_ROLLOVERS=2` cap was sized for "Slack hiccups during a normal-length conversation," not "we expect this to happen every 5 minutes during a 20-minute job."

The recent observation (a 7-minute `run_scheduled_message_now` call) confirmed Slack's chatStream has a ~5-minute lifetime regardless of the keepalive's 15-second title decorations + dot-trail appends. So no amount of "more activity" inside one chatStream avoids the issue. The only mechanism that works is opening a new chatStream before the old one expires.

The other live option (synthetic heartbeat events from tools — explored in the conversation that led to this proposal) was discarded once the 5-minute mark was confirmed: it bets that some amount of activity defeats Slack's TTL, but the evidence suggests Slack's TTL is wallclock-or-near-it. Preemptive rollover doesn't need that bet — it sidesteps the TTL entirely.

## Goals / Non-Goals

**Goals:**
- Long-running tools (>5 minutes) complete with a smooth visual flow: a sequence of N blocks, each rotated proactively before Slack expires.
- Zero reliance on Slack accepting any specific kind of "activity" as TTL-extending — the design assumes a hard TTL.
- The block boundary on a long job should not read as a failure. No "Continuing previous stream…" cue, no clobber of the thinking task title with "Acknowledged" after rotation, no visible artifact of in-flight tools being abandoned.
- Preemptive rotation is internal to `SlackStreamer` — no plumbing through `QueryToolContext`, `processMessage`, `runJobNow`, or any tool implementation. Pure streamer-layer change.
- Reactive rollover (today's failure-driven path) keeps working for genuine Slack outages, with its existing 2-rollover cap intact.

**Non-Goals:**
- Surfacing inner-Claude tool calls to the outer streamer (that was "Fix A" — postponed; addresses a different concern).
- Changing the synchronous semantics of `run_scheduled_message_now` or any other tool. The outer Claude turn still blocks on the tool result; we just keep the chatStream healthy throughout.
- Solving for jobs that take longer than the new preemptive-rollover cap (we'll set a cap high enough that normal long jobs fit, but a 2-hour runaway job is out of scope).
- Tuning Slack's actual TTL via experimentation. We pick a conservative interval (~4 min) and treat 5 min as the upper bound.

## Decisions

### Decision 1: Trigger preemptive rollover on a timer, not on append count

A timer that fires once at `PREEMPTIVE_ROLLOVER_INTERVAL_MS` after each block opens, scheduled at `start()` and re-scheduled inside `rollover()`. Initial interval: **4 minutes (240,000 ms)**. Conservative enough to leave a ~1-minute margin under Slack's observed TTL.

Alternatives considered:
- **Trigger after N appends.** Doesn't track wallclock — a chatty stream would rotate too soon, a quiet one too late.
- **Use the existing `keepalive` interval.** Mixes responsibilities (the keepalive's job is activity decoration; rotation is a separate concern). Splitting keeps each timer focused.

### Decision 2: Separate counters for preemptive and reactive rollovers

Replace today's `rolloverCount` with two fields:
- `preemptiveRolloverCount` (no hard cap, or a very high one like 20)
- `reactiveRolloverCount` (cap = 2, as today)

`streamDiagnostics()` surfaces both. `MAX_REACTIVE_ROLLOVERS` replaces `MAX_ROLLOVERS`.

Alternatives considered:
- **One counter, distinguish by source.** Possible but obscures the policy difference ("expected" vs "panic stop").
- **No cap on preemptive at all.** Risky — a runaway scheduler could spawn thousands of blocks. A high but real cap (~20 blocks = ~80 minutes of work) is safer.

### Decision 3: New block's first task is NOT grouped with the previous block's open group

This is the constraint the user emphasized. Rollover (preemptive or reactive) is a hard cut: the new block starts fresh. The previous block's `openGroup` is forgotten — neither its key, its title, nor its count crosses the boundary.

Operationally this is already true in today's `rollover()` (`this.openGroup = null` at line 170). We're documenting and preserving it: any future "carry state across rollover" optimization must NOT carry `openGroup`. A tool_start that would have folded into the prior block's group instead starts a fresh group on the new block.

### Decision 4: Quiet rotation copy on preemptive rollovers

Reactive rollover posts `"Continuing previous stream…"` as the thinking-task title. For preemptive rollover, that's misleading — nothing went wrong. The new block opens with the current thinking-task baseline:

- If the prior block was past `thinkingFinalized=true` (a tool had started), the new block opens with the current `thinkingTitle` ("Analyzing…") so the lifecycle continues unbroken.
- If the prior block was still pre-finalized (no tool ever started), the new block opens with "Acknowledged…" as if it were a fresh `start()`. (This case is rare for preemptive rollover — by 4 minutes in, *something* has fired.)

Reactive rollover keeps the existing `"Continuing previous stream…"` cue — the error semantics still apply there.

### Decision 5: Snapshot in-flight tasks and re-emit on the new block

Today's `rollover()` clears `taskSlack`, `taskLabels`, and `activeTasks`. Any `tool_end` arriving on the new block for a task that was in-flight when rotation happened becomes a silent no-op (`handleEvent` line 402-403). For a synchronous long-running tool, that's exactly the situation we land in.

New behavior:
1. Before clearing, capture `{ taskId, slackId, label, isGroup, startedAt }` for every entry in `activeTasks`.
2. On the prior block, mark each in-flight task as `complete` (this is technically wrong but the block is about to be abandoned; better than a frozen "in_progress" forever).
3. Open the new block.
4. Re-emit a fresh `task_start`-equivalent chunk on the new block for each captured task. Keep the same SDK-level `taskId` (so the eventual `tool_end` from the SDK still maps correctly), but reset `startedAt = now` so the keepalive's elapsed counter restarts cleanly on the new block.
5. Tools that were folded into a group on the prior block re-emerge as **standalone** tasks on the new block (per Decision 3). They don't reconstruct the group.

This preserves the user's mental model: "the trivia run is still going." It also fixes the tool_end-after-rollover silent-drop edge case for the preemptive path.

### Decision 6: THINKING_TASK_ID replay filter in append()'s catch handler

Independent of preemptive rollover, today's reactive path has a bug surfaced in the prior exploration: when `append()` rolls over and replays the failing chunks on the new stream, if the failing chunk targeted `THINKING_TASK_ID`, the replay overwrites the continuation cue ("Continuing previous stream…") with whatever the original chunk's title was ("Acknowledged…" or the keepalive idle title).

Fix: in `append()`'s catch handler, filter out chunks whose `id === THINKING_TASK_ID` from the replay. The rollover already posted the right title for that task id. If filtering leaves zero chunks, skip the retry entirely (the rollover post is sufficient).

Bundled into this change because:
1. Preemptive rollover would make the clobber more visible (more rollovers per session means more clobbers).
2. Both behaviors live in the same code path (`append()`'s catch + `rollover()`).
3. The spec scenario "Continuation cue is the thinking task title" needs to be tightened to enforce the post-rollover stickiness regardless.

### Decision 7: Cancel preemptive timer on stop / fail / stopped_by_user

The preemptive timer must not survive past:
- `stop()` (normal completion)
- A reactive failure that transitions to failed state (no rollover, or rollover exhausted)
- `stopped_by_user` (user-driven halt)

All three already clear `keepaliveTimer`; the preemptive timer joins that cleanup. Use `clearTimeout` (not `clearInterval`) since we want a one-shot per block.

## Risks / Trade-offs

**[Risk] Slack's actual TTL is shorter than 5 minutes in some workspaces** → Mitigation: 4-minute interval gives 60s margin under the observed bound; if real-world telemetry shows expiries at <4 min, we lower to 3 min.

**[Risk] A pathologically long job (e.g., 2 hours) spawns 30+ blocks** → Mitigation: preemptive cap of 20 (= ~80 minutes). Hitting the cap is rare enough that the existing failed-state fallback (chat.postMessage) is acceptable.

**[Risk] Re-emitting in-flight tasks creates duplicate-looking cards** if the user scrolls back to a prior block (it shows the same task that's now also on the new block, marked complete). → Mitigation: marking prior-block in-flight tasks `complete` before rotation makes the prior block read as "done its part." Cards across blocks are visually distinct (different Slack messages) so the duplication isn't obvious.

**[Risk] The new block opens with no visible task, looks like an empty placeholder for ~30 seconds before the next keepalive tick decorates the re-emitted in-flight task** → Mitigation: on re-emit, immediately fire a keepalive-equivalent decoration so the in-flight task shows its label + elapsed time from the moment the new block opens.

**[Risk] Preemptive rollover races with a reactive rollover** (e.g., preemptive fires at 4:00.000, an append fails at 4:00.005). → Mitigation: rollover is gated by `if (this.failed || this.stopped)` checks. If preemptive's `rollover()` starts first and is mid-flight when the failing append tries to rollover too, the second call sees `this.failed=false` (rollover resets it) and might attempt a double-rotation. Add a `rolloverInFlight` flag to serialize.

**[Trade-off] Block boundaries become visually meaningful** — users will start associating "new block" with "the run is making progress" rather than "something failed." That's a UX adjustment but probably a net improvement.

**[Trade-off] Each rotation is a fresh Slack API call** — for a 20-minute job at 4-minute rotations, that's 5 `chat.startStream` calls instead of 1. Negligible API cost; well under any rate limit.
