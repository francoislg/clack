## ADDED Requirements

### Requirement: Stream Rollover on Recoverable Failure

When an `appendStream` call fails with a recoverable Slack error code (`message_not_in_streaming_state` or `message_not_found`), the system SHALL open a new chat stream in the same channel and thread to continue posting task cards, up to a bounded number of rollovers per `SlackStreamer` instance. The new stream SHALL act as a clean continuation: no internal stream state (open groups, task mappings, active-task tracking, thinking-finalized flag) carries over from the failed stream. The system SHALL retain a per-instance ordered list of every `messageTs` the streamer has opened so that callers that need to clean up the streamer's footprint (skip, cancel, top-level repost) can reach every block.

#### Scenario: Recoverable failure triggers rollover within cap

- **WHEN** `appendStream` fails with `message_not_in_streaming_state` or `message_not_found`
- **AND** the current rollover count is strictly less than `MAX_ROLLOVERS` (2)
- **THEN** the system SHALL open a new chat stream in the same channel/thread via the same client and stream options used at `start()`
- **AND** the rollover count SHALL increment by 1
- **AND** the failing append's chunks SHALL be retried exactly once against the new stream
- **AND** the streamer SHALL NOT enter failed state if both the rollover and the retry succeed

#### Scenario: Continuation cue is the thinking task title

- **WHEN** a rollover succeeds and a new chat stream is opened
- **THEN** the first append against the new stream SHALL be a `task_update` chunk targeting the thinking task id with `in_progress` status and title `"Continuing previous stream…"`
- **AND** the `thinkingFinalized` flag SHALL be reset so that the title can subsequently follow the existing lifecycle (matches current tool when a tool starts, reverts to the default thinking title when tools idle)

#### Scenario: All stream-local state is cleared on rollover

- **WHEN** a rollover begins
- **THEN** the `openGroup`, `taskSlack`, `taskLabels`, and `activeTasks` collections SHALL be cleared before the first append on the new stream
- **AND** `lastEventAt` and `lastKeepaliveTickAt` SHALL be reset to the current time
- **AND** the previous block's `messageTs` SHALL be appended to the per-instance message timestamp list
- **AND** the current `messageTs` SHALL be cleared so that the first append on the new stream captures the new stream's ts

#### Scenario: Rollover cap exhausted falls back to existing failure path

- **WHEN** a recoverable failure occurs and the rollover count has already reached `MAX_ROLLOVERS`
- **THEN** the system SHALL NOT attempt another rollover
- **AND** the streamer SHALL enter the failed state, log via the existing warning path (including `rolloverCount` in diagnostics), and clear the keepalive timer
- **AND** the caller's existing `chat.postMessage` fallback path SHALL deliver the final response as today

#### Scenario: Rollover open itself fails

- **WHEN** the new `chatStream` open during rollover throws or its initial append fails
- **THEN** the streamer SHALL enter the failed state without retrying further rollovers within the same call
- **AND** the failure SHALL be logged with `rolloverCount` in diagnostics

#### Scenario: tool_end for a stale taskId after rollover is a no-op

- **WHEN** a `tool_end` event arrives for a taskId that was registered on a prior block and was cleared by rollover
- **THEN** `handleEvent` SHALL look up the slackId in `taskSlack`, find nothing, and return without emitting any chunks to the new stream

#### Scenario: tool_start in the new block opens a fresh task card

- **WHEN** a `tool_start` event arrives after a successful rollover
- **THEN** the event SHALL be handled identically to a `tool_start` arriving at the beginning of a fresh stream — a new task card is created in the new block with its own taskId mapping and `activeTasks` entry, and no association with any Block-1 state

#### Scenario: rolloverCount surfaced in diagnostics

- **WHEN** `streamDiagnostics()` is called (either by the warning log path after final failure, or by any future diagnostics consumer)
- **THEN** the returned object SHALL include a `rolloverCount` field reflecting the number of successful rollovers performed on this streamer instance

### Requirement: stopped_by_user Is a Deliberate Halt

When `appendStream` fails with `stopped_by_user`, the system SHALL recognize the failure as a deliberate user action, SHALL NOT attempt a rollover, and SHALL log the event at `warn` level (not `error`).

#### Scenario: stopped_by_user does not roll over

- **WHEN** `appendStream` fails with `stopped_by_user`
- **THEN** the streamer SHALL enter the failed state immediately without opening a new stream
- **AND** the failure SHALL be logged at `warn` level (not `error`)
- **AND** the log SHALL include `streamDiagnostics()` output

#### Scenario: stopped_by_user during a rollover-eligible session still halts

- **WHEN** `appendStream` fails with `stopped_by_user`
- **AND** the rollover count is below the cap
- **THEN** the system SHALL NOT attempt a rollover (user intent takes precedence over the cap)

### Requirement: All-Blocks Message Timestamp Accessor

The `SlackStreamer` SHALL expose a public method `getAllMessageTss(): string[]` that returns every `messageTs` the streamer has opened, in chronological order (oldest first). Callers that need to delete the streamer's full footprint (skip, cancel, top-level repost) SHALL iterate this list and call `chat.delete` for each ts. The existing `getMessageTs(): string | undefined` accessor SHALL continue to return the latest block's ts (where the final answer is rendered), which is also the only ts when no rollover occurred.

#### Scenario: getAllMessageTss returns one ts when no rollover happened

- **WHEN** a streamer ran end-to-end without rolling over
- **THEN** `getAllMessageTss()` SHALL return a single-element array equal to `[getMessageTs()!]`

#### Scenario: getAllMessageTss returns all tss in order after rollovers

- **WHEN** a streamer rolled over N times (1 ≤ N ≤ MAX_ROLLOVERS)
- **THEN** `getAllMessageTss()` SHALL return an array of length N+1
- **AND** the array SHALL be ordered oldest-first, with the final element equal to `getMessageTs()`

#### Scenario: getMessageTs returns the latest block's ts

- **WHEN** a streamer has rolled over at least once and the new block's first append has succeeded
- **THEN** `getMessageTs()` SHALL return the new block's `ts` (not the prior block's)

#### Scenario: Skip/cancel/top-level callers iterate getAllMessageTss

- **WHEN** `handleSkip`, `handleCancellation`, or `postTopLevel` (in `handlerResponse.ts`) needs to remove the streamer's messages
- **THEN** the caller SHALL iterate `getAllMessageTss()` and call `chat.delete` for each ts
- **AND** an individual `chat.delete` failure SHALL NOT halt iteration — the remaining tss SHALL still be attempted, with each failure logged at `warn` level

## MODIFIED Requirements

### Requirement: Stream Lifecycle

The system SHALL manage a Slack chat stream for each Claude query, using `chat.startStream` to begin, `chat.appendStream` to send task updates, and `chat.stopStream` to finalize the response with the answer and action buttons. The streamer SHALL also expose the message timestamp for post-delivery operations such as deletion. When `appendStream` fails with a recoverable error code, the streamer MAY transparently open a new chat stream in the same channel/thread to continue posting task cards (see the Stream Rollover requirement); the streamer enters failed state only when rollover is not attempted (cap exhausted, non-recoverable code, or rollover itself fails).

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

#### Scenario: Fallback on mid-flight stream failure after rollover exhausted

- **WHEN** `appendStream` fails and rollover is either not attempted (non-recoverable code, `stopped_by_user`) or the rollover cap has been exhausted
- **THEN** the streamer enters failed state and silently stops appending
- **AND** the keepalive timer is cleared
- **AND** on completion, the caller detects `hasFailed` and falls back to `chat.postMessage`
- **AND** calls `streamer.stop()` first to clear any loading state

#### Scenario: Known stream expiry logged as warning with diagnostics

- **WHEN** `appendStream` fails with `message_not_in_streaming_state` (either from handleEvent, keepalive, or stop) and the streamer enters failed state (no rollover attempted, or rollover exhausted)
- **THEN** the error is logged at `warn` level (not `error`)
- **AND** the log message SHALL include `msSinceLastTick` (milliseconds since the most recent keepalive tick fired)
- **AND** the log message SHALL include `msSinceLastEvent` (milliseconds since the most recent real `handleEvent` call)
- **AND** the log message SHALL include `activeTaskCount` (the number of tasks currently tracked as in-progress)
- **AND** the log message SHALL include `rolloverCount` (the number of successful rollovers performed before final failure)
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
