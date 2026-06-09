## MODIFIED Requirements

### Requirement: Stream Lifecycle

The system SHALL manage a Slack chat stream for each Claude query, using `chat.startStream` to begin, `chat.appendStream` to send task updates, and `chat.stopStream` to finalize the response with the answer and action buttons. The streamer SHALL also expose the message timestamp for post-delivery operations such as deletion. The streamer SHALL transparently rotate to a new chat stream **only reactively** — when `appendStream` fails with a recoverable error code (see the Reactive Stream Rollover requirement). There is no scheduled/preemptive rotation. Reactive rollover is unbounded: the streamer enters failed state only when rollover is not attempted (non-recoverable code, `stopped_by_user`) or when the new stream itself fails to open.

#### Scenario: Stream started on query begin

- **WHEN** a Claude query begins processing (any trigger mode)
- **THEN** the system starts a chat stream in the target channel/thread with `task_display_mode: "plan"`
- **AND** immediately shows an initial "Acknowledged, working on it..." task card in `in_progress` status

#### Scenario: Message timestamp captured on first append

- **WHEN** the first `append` call to the Slack streaming API returns successfully
- **THEN** the system captures the message `ts` from the API response
- **AND** exposes it via a `getMessageTs()` getter on SlackStreamer

#### Scenario: Message timestamp available after start

- **WHEN** `start()` completes successfully (the initial append posts the thinking task)
- **THEN** `getMessageTs()` returns the streaming message `ts`

#### Scenario: Message timestamp null on failed start

- **WHEN** `start()` fails and the streamer enters failed state
- **THEN** `getMessageTs()` returns `undefined`

#### Scenario: Stream stopped on query complete

- **WHEN** Claude's query completes and the answer is ready
- **THEN** the system marks the thinking task as `complete` and stops the stream
- **AND** the `stopStream` call includes the rendered answer blocks and action buttons

#### Scenario: Stream stopped on error

- **WHEN** Claude's query fails or returns an error
- **THEN** the system stops the stream and posts error content in the final message

#### Scenario: Fallback on stream start failure

- **WHEN** `startStream` fails (Slack API error)
- **THEN** the system sets the streamer to failed state
- **AND** the caller proceeds with Claude as normal
- **AND** on completion, falls back to `chat.postMessage` with the full response

#### Scenario: Fallback on mid-flight stream failure when rollover is skipped or its open fails

- **WHEN** `appendStream` fails and EITHER reactive rollover is skipped (non-recoverable code, or `stopped_by_user`) OR a rollover is attempted but the new stream fails to open
- **THEN** the streamer enters failed state and silently stops appending
- **AND** the keepalive timer is cleared
- **AND** on completion, the caller detects `hasFailed` and falls back to `chat.postMessage`
- **AND** calls `streamer.stop()` first to clear any loading state

#### Scenario: Known stream expiry logged as warning with diagnostics

- **WHEN** `appendStream` fails with `message_not_in_streaming_state` and the streamer enters failed state (only because the rollover's own new-stream open failed)
- **THEN** the error is logged at `warn` level (not `error`)
- **AND** the log message SHALL include `msSinceLastTick` (milliseconds since the most recent keepalive tick fired)
- **AND** the log message SHALL include `msSinceLastEvent` (milliseconds since the most recent real `handleEvent` call)
- **AND** the log message SHALL include `activeTaskCount` (the number of tasks currently tracked as in-progress)
- **AND** the log message SHALL include `reactiveRolloverCount` (the number of successful reactive rollovers performed so far)
- **AND** the streamer enters failed state as normal

#### Scenario: Cancellation stops stream

- **WHEN** a request is cancelled (e.g., via message edit)
- **THEN** the system stops the stream with a "_Request cancelled._" markdown text

#### Scenario: Stream always cleaned up

- **WHEN** processing completes (success, error, or exception)
- **THEN** the system calls `streamer.stop()` in a `finally` block to prevent orphaned streams
- **AND** `stop()` is idempotent -- safe to call multiple times
- **AND** the keepalive timer is always cleared

#### Scenario: Stream message deleted on skip

- **WHEN** a response is skipped and `getAllMessageTss()` returns one or more timestamps
- **THEN** the caller uses `chat.delete` with the channel and each `ts` to remove every block the streamer opened
- **AND** the thinking indicator and all task cards across every block disappear from Slack

### Requirement: Reactive Stream Rollover

When an `appendStream` call fails with a recoverable Slack error code (`message_not_in_streaming_state` or `message_not_found`), the system SHALL open a new chat stream in the same channel and thread to continue posting task cards. Reactive rollover is **unbounded** — there is no cap on the number of rollovers per `SlackStreamer` instance; a long-running task may open as many continuation blocks as Slack expiries require. Rollover is guarded so that a single expired stream produces exactly one rollover (see the Stream Generation Guard requirement). The new stream SHALL act as a clean continuation: no internal stream state (open groups, task mappings, active-task tracking) carries over to the new block, and the thinking-finalized flag SHALL be reset so the thinking task title can be updated independently on the new block. In-flight task tracking SHALL be re-emitted on the new block so that subsequent `tool_end` events for tasks that were running when rotation occurred are not silently dropped. The system SHALL retain a per-instance ordered list of every `messageTs` the streamer has opened so that callers that need to clean up the streamer's footprint (skip, cancel, top-level repost) can reach every block.

#### Scenario: Recoverable failure triggers reactive rollover

- **WHEN** `appendStream` fails with `message_not_in_streaming_state` or `message_not_found`
- **AND** the failing append's snapshotted generation still matches the current stream generation (this append is the first to discover the stream died — see the Stream Generation Guard requirement)
- **THEN** the system SHALL open a new chat stream in the same channel/thread via the same client and stream options used at `start()`
- **AND** the reactive rollover count SHALL increment by 1 (for diagnostics only; it is not compared against any cap)
- **AND** the failing append's chunks SHALL be retried exactly once against the new stream, with one exception: any chunk whose `id` equals the thinking task id SHALL be filtered out of the replay
- **AND** the streamer SHALL NOT enter failed state if both the rollover and the retry succeed

#### Scenario: Thinking task id chunks are filtered from rollover replay

- **WHEN** the chunks that failed to append included a `task_update` targeting the thinking task id (e.g., the initial "Acknowledged" post from `start()`, or a pre-finalize keepalive idle ping)
- **AND** rollover succeeds and replay begins
- **THEN** the replay SHALL omit those thinking-task-id chunks
- **AND** the continuation cue posted by rollover for the thinking task id SHALL remain the visible title on the new block
- **AND** if the filter empties the replay list, the retry SHALL be skipped (no append is made to the new stream beyond the rollover's own first chunk)

#### Scenario: Continuation cue on reactive rollover

- **WHEN** a reactive rollover succeeds and a new chat stream is opened
- **THEN** the first append against the new stream SHALL be a `task_update` chunk targeting the thinking task id with `in_progress` status and title `"Continuing previous stream…"`
- **AND** the `thinkingFinalized` flag SHALL be reset so that the title can subsequently follow the existing lifecycle (matches current tool when a tool starts, reverts to the default thinking title when tools idle)

#### Scenario: Stream-local state is cleared and in-flight tasks re-emitted on reactive rollover

- **WHEN** a reactive rollover begins
- **THEN** the system SHALL snapshot every entry in `activeTasks` and the corresponding `taskLabels` value before clearing
- **AND** on the prior block, every snapshotted in-flight task SHALL be marked `complete` via a final `task_update` append (silently swallowed if it fails — the block is about to be abandoned)
- **AND** the `openGroup`, `taskSlack`, `taskLabels`, and `activeTasks` collections SHALL be cleared
- **AND** `lastEventAt` and `lastKeepaliveTickAt` SHALL be reset to the current time
- **AND** the previous block's `messageTs` SHALL be appended to the per-instance message timestamp list
- **AND** the current `messageTs` SHALL be cleared so that the first append on the new stream captures the new stream's ts
- **AND** after the rollover's continuation-cue chunk lands on the new block, the snapshotted in-flight tasks SHALL be re-emitted on the new block as **standalone** `in_progress` task cards using the same SDK-level task id (so the eventual `tool_end` from the SDK still maps), with `startedAt` reset to the rollover time
- **AND** the re-emitted tasks SHALL NOT carry the prior block's group folding (each is a fresh standalone card on the new block, regardless of whether it was part of an `openGroup` on the prior block)

#### Scenario: Rollover open itself fails

- **WHEN** the new `chatStream` open during a reactive rollover throws or its initial append fails
- **THEN** the streamer SHALL enter the failed state without retrying further rollovers within the same call
- **AND** the failure SHALL be logged with `reactiveRolloverCount` in diagnostics

#### Scenario: tool_end for a stale taskId after rollover is a no-op when not re-emitted

- **WHEN** a `tool_end` event arrives for a taskId that was NOT among the in-flight tasks re-emitted on the new block (e.g., the task had already completed on the prior block before rotation)
- **THEN** `handleEvent` SHALL look up the slackId in `taskSlack`, find nothing, and return without emitting any chunks to the new stream

#### Scenario: tool_end for a re-emitted in-flight taskId lands on the new block

- **WHEN** a `tool_end` event arrives for a taskId that was in-flight at rollover time and was re-emitted on the new block
- **THEN** `handleEvent` SHALL find the slackId in the new block's `taskSlack`
- **AND** SHALL mark the re-emitted task `complete` on the new block as normal

#### Scenario: tool_start in the new block opens a fresh task card

- **WHEN** a `tool_start` event arrives after a successful rollover for a task that was NOT in-flight at rollover time
- **THEN** the event SHALL be handled identically to a `tool_start` arriving at the beginning of a fresh stream — a new task card is created in the new block with its own taskId mapping and `activeTasks` entry, and no association with any prior-block state

#### Scenario: Group folding does NOT cross a rollover boundary

- **WHEN** the prior block had an `openGroup` (one or more tools folded into a single grouped task card)
- **AND** a reactive rollover occurs
- **THEN** the new block SHALL NOT carry over the group's key, title, count, or maxDetails
- **AND** any subsequent `tool_start` on the new block that would have folded into that group on the prior block SHALL instead open a fresh standalone card or start a brand-new group on the new block
- **AND** re-emitted in-flight tasks that were grouped on the prior block SHALL appear as standalone cards on the new block

#### Scenario: Rollover counter surfaced in diagnostics

- **WHEN** `streamDiagnostics()` is called (by the warning log path after a failed rollover open, or by any future diagnostics consumer)
- **THEN** the returned object SHALL include a `reactiveRolloverCount` field reflecting the number of successful reactive rollovers performed on this streamer instance

### Requirement: All-Blocks Message Timestamp Accessor

The `SlackStreamer` SHALL expose a public method `getAllMessageTss(): string[]` that returns every `messageTs` the streamer has opened, in chronological order (oldest first). Callers that need to delete the streamer's full footprint (skip, cancel, top-level repost) SHALL iterate this list and call `chat.delete` for each ts. The existing `getMessageTs(): string | undefined` accessor SHALL continue to return the latest block's ts (where the final answer is rendered), which is also the only ts when no rollover occurred.

#### Scenario: getAllMessageTss returns one ts when no rollover happened

- **WHEN** a streamer ran end-to-end without rolling over
- **THEN** `getAllMessageTss()` SHALL return a single-element array equal to `[getMessageTs()!]`

#### Scenario: getAllMessageTss returns all tss in order after rollovers

- **WHEN** a streamer rolled over N times (N ≥ 1, unbounded)
- **THEN** `getAllMessageTss()` SHALL return an array of length N+1
- **AND** the array SHALL be ordered oldest-first, with the final element equal to `getMessageTs()`

#### Scenario: getMessageTs returns the latest block's ts

- **WHEN** a streamer has rolled over at least once and the new block's first append has succeeded
- **THEN** `getMessageTs()` SHALL return the new block's `ts` (not the prior block's)

#### Scenario: Skip/cancel/top-level callers iterate getAllMessageTss

- **WHEN** `handleSkip`, `handleCancellation`, or `postTopLevel` (in `handlerResponse.ts`) needs to remove the streamer's messages
- **THEN** the caller SHALL iterate `getAllMessageTss()` and call `chat.delete` for each ts
- **AND** an individual `chat.delete` failure SHALL NOT halt iteration — the remaining tss SHALL still be attempted, with each failure logged at `warn` level

## ADDED Requirements

### Requirement: Stream Generation Guard

The `SlackStreamer` SHALL track a monotonically increasing `generation` counter that identifies the current chat stream. The counter SHALL be incremented immediately after each successful chat stream open (both at `start()` and on every successful reactive rollover), after `this.chatStreamer` has been reassigned to the new stream — so any append that observes the new generation also observes the new stream handle. Each `append()` SHALL snapshot the current generation before issuing its API call. On a recoverable append failure, the streamer SHALL roll over only if the snapshotted generation still equals the current generation; otherwise the stream has already been rolled over by a sibling append and the failing append SHALL NOT trigger a second rollover — it SHALL instead replay onto the current stream, or return without appending and without error if the filtered replay list is empty. The generation compare covers the window AFTER a rollover has completed; a single-flight in-flight-rollover guard covers the window DURING a rollover (a sibling failing while `openChatStream` is still awaiting SHALL await the same in-flight rollover and then replay, never start a second one). Together they guarantee that a single expired stream — which causes every in-flight fire-and-forget append (events and keepalive) to reject — produces exactly one rollover and exactly one new block.

#### Scenario: Generation bumped on each successful stream open

- **WHEN** a chat stream is opened successfully at `start()` or during a rollover
- **THEN** the `generation` counter SHALL increment by 1 after the open succeeds

#### Scenario: First failing append from the live generation rolls over

- **WHEN** an `appendStream` call fails with a recoverable code
- **AND** the append's snapshotted generation equals the current `generation`
- **THEN** the streamer SHALL perform exactly one reactive rollover, advancing the generation
- **AND** the failing chunks SHALL replay onto the new stream per the Reactive Stream Rollover requirement

#### Scenario: Stale append from a superseded generation does not roll over again

- **WHEN** an `appendStream` call fails with a recoverable code
- **AND** the append's snapshotted generation is older than the current `generation` (a sibling append already rolled this stream over)
- **THEN** the streamer SHALL NOT open a new chat stream
- **AND** SHALL instead replay the failing chunks (excluding any thinking-task-id chunk) onto the current stream, or drop them if the replay list is empty
- **AND** the `reactiveRolloverCount` SHALL NOT increment for this append

#### Scenario: Concurrent expiry rejections collapse to one rollover

- **WHEN** a stream expires and multiple in-flight fire-and-forget appends (e.g. a keepalive tick plus one or more tool-event appends) all reject with a recoverable code in the same window
- **THEN** exactly one of them SHALL open a new chat stream (the first to observe the live generation)
- **AND** every other rejection SHALL fall into the superseded-generation path and SHALL NOT open an additional stream
- **AND** the thread SHALL gain exactly one new continuation block for that expiry

## REMOVED Requirements

### Requirement: Preemptive Stream Rollover

**Reason**: The 4-minute preemptive timer rotated healthy, actively-streaming cards on a blind schedule to dodge Slack's ~5-minute TTL. In practice the 15-second keepalive already surfaces a real expiry within 15s, so reactive rollover alone keeps the stream alive. The timer's only net effects were extra card churn and a timing race against in-flight keepalive appends (a stale append firing a second rollover that abandoned a just-opened block after a single `⏱ 0s` re-emit). Removing it eliminates both, and the Stream Generation Guard makes reactive rollover reliable on its own.

**Migration**: No external migration. All preemptive machinery is internal to `SlackStreamer`: `PREEMPTIVE_ROLLOVER_INTERVAL_MS`, `MAX_PREEMPTIVE_ROLLOVERS`, `preemptiveRolloverCount`, `preemptiveTimer`, `schedulePreemptiveRollover()`, `clearPreemptiveTimer()`, and the `preemptive` branch of `rollover()` are deleted. `streamDiagnostics()` drops its `preemptiveRolloverCount` field. Callers and Slack-visible behavior are otherwise unchanged (cards still roll over, just only on real expiry).

### Requirement: MAX_REACTIVE_ROLLOVERS Constant Rename

**Reason**: Reactive rollover is now unbounded ("if it's taking too long, so be it"), so the `MAX_REACTIVE_ROLLOVERS = 2` cap is removed entirely. Its anti-flapping purpose is now served by the Stream Generation Guard (one rollover per expiry) and by the natural pacing of ~5-minute Slack expiries, so no numeric ceiling is needed. A genuinely broken stream still terminates the loop via the rollover-open-failure path, which sets failed state.

**Migration**: No external migration. Delete the `MAX_REACTIVE_ROLLOVERS` constant and the cap comparison in `append()`'s recoverable-failure branch. `reactiveRolloverCount` is retained as a diagnostics-only counter (no longer compared against any limit). Tests asserting the cap-exhausted fallback are removed.
