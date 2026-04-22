## MODIFIED Requirements

### Requirement: Stream Keepalive
The system SHALL periodically send keepalive appends to prevent Slack from expiring the chat stream during idle periods. Keepalive content SHALL target every currently in-progress task that has been running for at least a visible-progress threshold, updating the task's title with a live elapsed-time suffix and appending incremental content to the task's details field to ensure Slack registers the update as activity.

#### Scenario: Keepalive timer started after stream starts
- **WHEN** `start()` completes successfully (initial append succeeds)
- **THEN** a periodic keepalive timer is started at a fixed interval (15 seconds)

#### Scenario: Per-task tracking of in-progress work
- **WHEN** a tool call starts and results in a new task card
- **THEN** the system records that task's `startedAt` time and base title in an active-task map
- **WHEN** a tool call joins an existing group (same consecutive group key)
- **THEN** the group's `startedAt` time is NOT reset
- **WHEN** a tool call completes and causes its task card to transition to `complete` status
- **THEN** the task is removed from the active-task map

#### Scenario: Keepalive decorates long-running tasks with elapsed time
- **WHEN** the keepalive timer fires and an in-progress task has been running for at least 30 seconds
- **THEN** the system appends a `task_update` chunk for that task containing a `title` with the current base title plus a ` :stopwatch: {elapsed}` suffix (where `{elapsed}` is formatted as `45s`, `1m 5s`, etc.)
- **AND** the chunk contains a `details` field appending `" ."` (or `"\n ."` on the first decoration tick for that task) to accumulate a visible dot trail

#### Scenario: Fast tasks not decorated
- **WHEN** the keepalive timer fires and an in-progress task has been running for less than 30 seconds
- **THEN** no decoration update is emitted for that task

#### Scenario: Keepalive handles parallel tasks independently
- **WHEN** two or more tasks are simultaneously in-progress and both exceed the 30-second threshold
- **THEN** each task receives its own elapsed-time decoration based on its individual `startedAt`
- **AND** a single tick emits one `task_update` chunk per decorated task

#### Scenario: Grouped task title stays current
- **WHEN** the keepalive timer fires for a grouped in-progress task whose item count has changed since the task started
- **THEN** the emitted title uses the current group title (e.g., `Running commands (3)`) as the base before the `:stopwatch:` suffix

#### Scenario: Keepalive also fires when no task is active
- **WHEN** the keepalive timer fires and no task is in-progress (e.g., before the first tool event or between tool completion and a follow-up)
- **THEN** the system SHALL emit a `task_update` chunk targeting the thinking task id
- **AND** the chunk SHALL contain the current thinking task title and `in_progress` status, preserving the pre-existing fallback behavior for pre-first-tool dead zones

#### Scenario: Keepalive dots append after existing details content
- **WHEN** a task already has `details` content (e.g., grouped itemDetails from prior tool calls) and keepalive appends a dot on a subsequent tick
- **THEN** the dot SHALL be appended below the existing content (not replacing it), consistent with Slack's `details` field append semantics

#### Scenario: Keepalive skipped when stream is stopped
- **WHEN** the keepalive timer fires after `stop()` has been called
- **THEN** no append is sent and the timer is cleared

#### Scenario: Keepalive skipped when stream has failed
- **WHEN** the keepalive timer fires after the stream has entered failed state
- **THEN** no append is sent and the timer is cleared

#### Scenario: Keepalive timer cleared on stop
- **WHEN** `stop()` is called (normal completion)
- **THEN** the keepalive timer is cleared before any finalization appends

#### Scenario: Keepalive timer cleared on start failure
- **WHEN** `start()` fails (Slack API error on initial append)
- **THEN** no keepalive timer is started

#### Scenario: Keepalive failure triggers stream failed state
- **WHEN** a keepalive append fails with an API error
- **THEN** the streamer enters failed state (`hasFailed` returns true)
- **AND** the keepalive timer is cleared

### Requirement: Stream Lifecycle
The system SHALL manage a Slack chat stream for each Claude query, using `chat.startStream` to begin, `chat.appendStream` to send task updates, and `chat.stopStream` to finalize the response with the answer and action buttons. The streamer SHALL also expose the message timestamp for post-delivery operations such as deletion. Stream expiry warnings SHALL include diagnostic timing fields so operators can measure Slack's real inactivity timeout from production logs.

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

#### Scenario: Fallback on mid-flight stream failure
- **WHEN** `appendStream` fails during processing
- **THEN** the streamer enters failed state and silently stops appending
- **AND** the keepalive timer is cleared
- **AND** on completion, the caller detects `hasFailed` and falls back to `chat.postMessage`
- **AND** calls `streamer.stop()` first to clear any loading state

#### Scenario: Known stream expiry logged as warning with diagnostics
- **WHEN** `appendStream` fails with `message_not_in_streaming_state` (either from handleEvent, keepalive, or stop)
- **THEN** the error is logged at `warn` level (not `error`)
- **AND** the log message SHALL include `msSinceLastTick` (milliseconds since the most recent keepalive tick fired)
- **AND** the log message SHALL include `msSinceLastEvent` (milliseconds since the most recent real `handleEvent` call)
- **AND** the log message SHALL include `activeTaskCount` (the number of tasks currently tracked as in-progress)
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
- **WHEN** a response is skipped and `getMessageTs()` returns a valid timestamp
- **THEN** the caller uses `chat.delete` with the channel and message `ts` to remove the stream message
- **AND** the thinking indicator and all task cards disappear from Slack
