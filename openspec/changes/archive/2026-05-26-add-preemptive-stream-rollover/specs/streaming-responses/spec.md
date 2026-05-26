## MODIFIED Requirements

### Requirement: Stream Lifecycle

The system SHALL manage a Slack chat stream for each Claude query, using `chat.startStream` to begin, `chat.appendStream` to send task updates, and `chat.stopStream` to finalize the response with the answer and action buttons. The streamer SHALL also expose the message timestamp for post-delivery operations such as deletion. The streamer SHALL transparently rotate to a new chat stream in two situations: (1) **reactively**, when `appendStream` fails with a recoverable error code (see the Reactive Stream Rollover requirement); and (2) **preemptively**, on a fixed schedule before Slack's stream TTL elapses (see the Preemptive Stream Rollover requirement). The streamer enters failed state only when reactive rollover is not attempted (reactive cap exhausted, non-recoverable code, or the new stream itself fails to open).

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

#### Scenario: Fallback on mid-flight stream failure after reactive rollover exhausted

- **WHEN** `appendStream` fails and reactive rollover is either not attempted (non-recoverable code, `stopped_by_user`) or the reactive rollover cap has been exhausted
- **THEN** the streamer enters failed state and silently stops appending
- **AND** the keepalive timer is cleared
- **AND** the preemptive rollover timer is cleared
- **AND** on completion, the caller detects `hasFailed` and falls back to `chat.postMessage`
- **AND** calls `streamer.stop()` first to clear any loading state

#### Scenario: Known stream expiry logged as warning with diagnostics

- **WHEN** `appendStream` fails with `message_not_in_streaming_state` (either from handleEvent, keepalive, or stop) and the streamer enters failed state (no reactive rollover attempted, or reactive cap exhausted)
- **THEN** the error is logged at `warn` level (not `error`)
- **AND** the log message SHALL include `msSinceLastTick` (milliseconds since the most recent keepalive tick fired)
- **AND** the log message SHALL include `msSinceLastEvent` (milliseconds since the most recent real `handleEvent` call)
- **AND** the log message SHALL include `activeTaskCount` (the number of tasks currently tracked as in-progress)
- **AND** the log message SHALL include `reactiveRolloverCount` (the number of successful reactive rollovers performed before final failure)
- **AND** the log message SHALL include `preemptiveRolloverCount` (the number of successful preemptive rollovers performed on this streamer)
- **AND** the streamer enters failed state as normal

#### Scenario: Cancellation stops stream

- **WHEN** a request is cancelled (e.g., via message edit)
- **THEN** the system stops the stream with a "_Request cancelled._" markdown text

#### Scenario: Stream always cleaned up

- **WHEN** processing completes (success, error, or exception)
- **THEN** the system calls `streamer.stop()` in a `finally` block to prevent orphaned streams
- **AND** `stop()` is idempotent -- safe to call multiple times
- **AND** the keepalive timer is always cleared
- **AND** the preemptive rollover timer is always cleared

#### Scenario: Stream message deleted on skip

- **WHEN** a response is skipped and `getAllMessageTss()` returns one or more timestamps
- **THEN** the caller uses `chat.delete` with the channel and each `ts` to remove every block the streamer opened
- **AND** the thinking indicator and all task cards across every block disappear from Slack

### Requirement: Reactive Stream Rollover

When an `appendStream` call fails with a recoverable Slack error code (`message_not_in_streaming_state` or `message_not_found`), the system SHALL open a new chat stream in the same channel and thread to continue posting task cards, up to a bounded number of reactive rollovers per `SlackStreamer` instance. The new stream SHALL act as a clean continuation: no internal stream state (open groups, task mappings, active-task tracking) carries over to the new block, and the thinking-finalized flag SHALL be reset so the thinking task title can be updated independently on the new block. In-flight task tracking SHALL be re-emitted on the new block so that subsequent `tool_end` events for tasks that were running when rotation occurred are not silently dropped. The system SHALL retain a per-instance ordered list of every `messageTs` the streamer has opened so that callers that need to clean up the streamer's footprint (skip, cancel, top-level repost) can reach every block.

#### Scenario: Recoverable failure triggers reactive rollover within cap

- **WHEN** `appendStream` fails with `message_not_in_streaming_state` or `message_not_found`
- **AND** the current reactive rollover count is strictly less than `MAX_REACTIVE_ROLLOVERS` (2)
- **THEN** the system SHALL open a new chat stream in the same channel/thread via the same client and stream options used at `start()`
- **AND** the reactive rollover count SHALL increment by 1
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

#### Scenario: Reactive rollover cap exhausted falls back to existing failure path

- **WHEN** a recoverable failure occurs and the reactive rollover count has already reached `MAX_REACTIVE_ROLLOVERS`
- **THEN** the system SHALL NOT attempt another reactive rollover
- **AND** the streamer SHALL enter the failed state, log via the existing warning path (including `reactiveRolloverCount` and `preemptiveRolloverCount` in diagnostics), and clear both the keepalive timer and the preemptive rollover timer
- **AND** the caller's existing `chat.postMessage` fallback path SHALL deliver the final response as today

#### Scenario: Rollover open itself fails

- **WHEN** the new `chatStream` open during rollover (reactive or preemptive) throws or its initial append fails
- **THEN** the streamer SHALL enter the failed state without retrying further rollovers within the same call
- **AND** the failure SHALL be logged with `reactiveRolloverCount` and `preemptiveRolloverCount` in diagnostics

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
- **AND** a rollover (reactive or preemptive) occurs
- **THEN** the new block SHALL NOT carry over the group's key, title, count, or maxDetails
- **AND** any subsequent `tool_start` on the new block that would have folded into that group on the prior block SHALL instead open a fresh standalone card or start a brand-new group on the new block
- **AND** re-emitted in-flight tasks that were grouped on the prior block SHALL appear as standalone cards on the new block

#### Scenario: Rollover counters surfaced in diagnostics

- **WHEN** `streamDiagnostics()` is called (either by the warning log path after final failure, or by any future diagnostics consumer)
- **THEN** the returned object SHALL include a `reactiveRolloverCount` field reflecting the number of successful reactive rollovers performed on this streamer instance
- **AND** the returned object SHALL include a `preemptiveRolloverCount` field reflecting the number of successful preemptive rollovers performed on this streamer instance

## ADDED Requirements

### Requirement: Preemptive Stream Rollover

To stay under Slack's empirically-observed ~5-minute chatStream TTL, the system SHALL proactively rotate the current chat stream to a fresh one on a fixed schedule, regardless of whether the current stream is still healthy. Preemptive rollovers SHALL be tracked separately from reactive rollovers, use a separate (higher) cap, and present a quieter visual cue than the reactive path. The rotation SHALL happen entirely inside `SlackStreamer` — no caller, tool, or upstream code path needs to be aware of it.

#### Scenario: Preemptive timer scheduled after start

- **WHEN** `start()` completes successfully (the initial append posts the thinking task)
- **THEN** a one-shot preemptive rollover timer SHALL be scheduled at `PREEMPTIVE_ROLLOVER_INTERVAL_MS` (4 minutes) from the current time

#### Scenario: Preemptive timer re-scheduled after each rollover

- **WHEN** a rollover (reactive or preemptive) completes successfully and opens a new chat stream
- **THEN** any existing preemptive rollover timer SHALL be cleared
- **AND** a new one-shot preemptive rollover timer SHALL be scheduled at `PREEMPTIVE_ROLLOVER_INTERVAL_MS` from the rollover completion time

#### Scenario: Preemptive timer fires and rotates

- **WHEN** the preemptive timer elapses and the streamer is neither failed nor stopped
- **THEN** the system SHALL initiate a rollover marked as preemptive
- **AND** the `preemptiveRolloverCount` SHALL increment by 1 on success
- **AND** the rollover SHALL clear stream-local state and re-emit in-flight tasks identically to a reactive rollover (per the "Stream-local state is cleared and in-flight tasks re-emitted on reactive rollover" scenario)

#### Scenario: Preemptive rollover uses quiet continuation copy

- **WHEN** a preemptive rollover opens a new chat stream
- **THEN** the first append against the new stream SHALL be a `task_update` chunk targeting the thinking task id with `in_progress` status
- **AND** the title SHALL NOT be the reactive cue `"Continuing previous stream…"`
- **AND** the title SHALL instead be derived from the streamer's lifecycle state at the moment the preemptive rollover begins — the configured `thinkingTitle` (e.g., `"Analyzing…"`) if `thinkingFinalized` is `true` at that moment, otherwise the initial `"Acknowledged, working on it..."` title
- **AND** the `thinkingFinalized` flag SHALL be preserved across a preemptive rollover (NOT reset to `false`) so that the lifecycle state continues unbroken on the new block — i.e., if a tool had already started on the prior block, subsequent keepalive idle pings on the new block still use `thinkingTitle`, not the "Acknowledged" default

#### Scenario: Preemptive rollover fires during idle period

- **WHEN** the preemptive timer fires
- **AND** no `appendStream` call is in flight at the moment the timer fires (the streamer is idle between events, e.g., waiting on a long-running tool to return)
- **THEN** the streamer SHALL still initiate the preemptive rollover
- **AND** SHALL open a new chatStream and post the quiet continuation chunk for the thinking task id
- **AND** SHALL re-emit any in-flight tasks per the snapshot/re-emit scenario, even though no failing chunk triggered the rotation

#### Scenario: Preemptive rollover cap is higher than reactive

- **WHEN** the preemptive rollover count reaches `MAX_PREEMPTIVE_ROLLOVERS` (20)
- **THEN** the system SHALL stop scheduling further preemptive timers for this streamer instance
- **AND** SHALL log a warning with both counters when the cap is reached
- **AND** subsequent reactive failures SHALL still be eligible for reactive rollover if within the reactive cap

#### Scenario: Preemptive timer cleared on stop

- **WHEN** `stop()` is called
- **THEN** the preemptive timer SHALL be cleared before any finalization appends

#### Scenario: Preemptive timer cleared on failed state

- **WHEN** the streamer enters failed state (reactive cap exhausted, non-recoverable failure, rollover open failure, or `stopped_by_user`)
- **THEN** the preemptive timer SHALL be cleared
- **AND** SHALL NOT fire again for this streamer instance

#### Scenario: Preemptive rollover does not race with a concurrent reactive rollover

- **WHEN** a preemptive rollover is in flight (the new chatStream is being opened or the continuation cue is being posted)
- **AND** a concurrent `appendStream` call from `handleEvent` or `keepalive` fails with a recoverable code during the same window
- **THEN** the streamer SHALL serialize the rollover work via a `rolloverInFlight` flag
- **AND** the concurrent failure SHALL NOT trigger a second `chatStream` open while the first is still resolving (exactly one `chat.startStream` call lands across the race)
- **AND** the failing chunk SHALL be dropped without retry if its `id` equals `THINKING_TASK_ID` (the THINKING_TASK_ID replay filter still applies)
- **AND** for any other failing chunk, the chunk SHALL be retried on the new stream exactly once after the in-flight preemptive rollover completes successfully; if the in-flight rollover itself fails to open the new stream, the queued chunk SHALL be dropped and the streamer SHALL enter failed state per the existing rollover-open-failure scenario

#### Scenario: Preemptive timer is not started when start() fails

- **WHEN** `start()` enters failed state (e.g., `startStream` API error)
- **THEN** no preemptive rollover timer SHALL be started

#### Scenario: Preemptive timer unref'd to not block process exit

- **WHEN** the preemptive timer is scheduled
- **THEN** the timer SHALL call `.unref()` so it does not keep a Node.js process alive when no other work is pending

### Requirement: MAX_REACTIVE_ROLLOVERS Constant Rename

The constant previously named `MAX_ROLLOVERS` in `SlackStreamer` SHALL be renamed to `MAX_REACTIVE_ROLLOVERS` to disambiguate it from the new preemptive cap. The numeric value SHALL remain `2`. The constant is internal to `SlackStreamer` and not exposed; the rename is for clarity inside the file and its tests.

#### Scenario: Reactive cap value unchanged

- **WHEN** the streamer has performed 2 reactive rollovers and a 3rd recoverable failure occurs
- **THEN** the streamer SHALL enter the failed state without attempting a 3rd reactive rollover
- **AND** the behavior SHALL match the prior `MAX_ROLLOVERS=2` semantics exactly

#### Scenario: Reactive cap is independent of preemptive cap

- **WHEN** the streamer has performed multiple preemptive rollovers
- **THEN** the preemptive count SHALL NOT consume any of the 2 reactive cap slots
- **AND** the streamer SHALL still be eligible for up to 2 reactive rollovers regardless of how many preemptive rollovers have occurred
