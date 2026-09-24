# streaming-responses Specification

## Purpose

Manage Slack chat streams for Claude queries, displaying real-time tool call progress as task cards and delivering the final answer via stream finalization.

## Requirements

### Requirement: Stream Lifecycle

The system SHALL manage a Slack chat stream for each Claude query, using `chat.startStream` to begin, `chat.appendStream` to send task updates, and `chat.stopStream` to finalize the response with the answer and action buttons. The streamer SHALL also expose the message timestamp for post-delivery operations such as deletion. The streamer SHALL transparently rotate to a new chat stream **only reactively** — when `appendStream` fails with a recoverable error code (see the Reactive Stream Rollover requirement). There is no scheduled/preemptive rotation. Under the `streamThenUpdate` task-card transport the card instead moves onto `chat.update` edits of the same message (see the Task-Card Transport requirement), and rollover applies only when that message's `ts` is not yet known. Reactive rollover is unbounded: the streamer enters failed state only when rollover is not attempted (non-recoverable code, `stopped_by_user`) or when the new stream itself fails to open.

A stream MAY be started in **deferred** mode (see the `deferred-progress-surface` capability). In deferred mode `start()` SHALL construct the chat-stream handle but SHALL NOT append the initial thinking task, so no Slack message is created until the stream commits. A successful `start()` therefore does not imply that a Slack message exists.

#### Scenario: Stream started on query begin

- **WHEN** a Claude query begins processing with a non-deferred stream (any user-initiated trigger mode)
- **THEN** the system starts a chat stream in the target channel/thread with `task_display_mode: "plan"`
- **AND** immediately shows an initial "Acknowledged, working on it..." task card in `in_progress` status

#### Scenario: Deferred stream start creates no message

- **WHEN** a Claude query begins processing with a deferred stream
- **THEN** the system constructs the chat-stream handle
- **AND** does NOT append the initial thinking task
- **AND** no Slack message exists for the stream

#### Scenario: Message timestamp captured on first append

- **WHEN** the first `append` call to the Slack streaming API returns successfully
- **THEN** the system captures the message `ts` from the API response
- **AND** exposes it via a `getMessageTs()` getter on SlackStreamer

#### Scenario: Message timestamp available after start

- **WHEN** a non-deferred `start()` completes successfully (the initial append posts the thinking task)
- **THEN** `getMessageTs()` returns the streaming message `ts`

#### Scenario: Message timestamp absent while deferred and uncommitted

- **WHEN** `start()` completes successfully in deferred mode and the stream has not committed
- **THEN** `getMessageTs()` returns `undefined`
- **AND** `getAllMessageTss()` returns an empty array

#### Scenario: Message timestamp null on failed start

- **WHEN** `start()` fails and the streamer enters failed state
- **THEN** `getMessageTs()` returns `undefined`

#### Scenario: Stream stopped on query complete

- **WHEN** Claude's query completes and the answer is ready
- **THEN** the system marks the thinking task as `complete` and stops the stream
- **AND** the `stopStream` call includes the rendered answer blocks and action buttons

#### Scenario: Stop is inert on an uncommitted deferred stream

- **WHEN** `stop()` is called on a deferred stream that has not committed
- **THEN** no completion task is appended, no stream is started, and no message is created
- **AND** the call returns without error

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

#### Scenario: Cancellation discards the stream

- **WHEN** a run is cancelled (e.g., via the stop reaction or inline stop emoji)
- **THEN** the delivery handler winds the surface down with `discard: true`, removing every message the streamer opened
- **AND** no cancellation text is posted through the streamer
- **AND** when the stream is deferred and uncommitted, there is nothing to remove and no Slack call is made

#### Scenario: Stream always cleaned up

- **WHEN** processing completes (success, error, or exception)
- **THEN** the system calls `streamer.stop()` in a `finally` block to prevent orphaned streams
- **AND** `stop()` is idempotent -- safe to call multiple times
- **AND** the keepalive timer is always cleared
- **AND** for a deferred stream that never committed, the `finally` call makes no Slack call (see "Stop is inert on an uncommitted deferred stream")

#### Scenario: Stream message deleted on skip

- **WHEN** a response is skipped and `getAllMessageTss()` returns one or more timestamps
- **THEN** the caller uses `chat.delete` with the channel and each `ts` to remove every block the streamer opened
- **AND** the thinking indicator and all task cards across every block disappear from Slack
- **AND** when `getAllMessageTss()` returns an empty array (a deferred stream that never committed), no `chat.delete` call is made

### Requirement: Reactive Stream Rollover

When an `appendStream` call fails with a recoverable Slack error code (`message_not_in_streaming_state` or `message_not_found`) under the default `stream` task-card transport (or under `streamThenUpdate` before the card's message `ts` is known), the system SHALL open a new chat stream in the same channel and thread to continue posting task cards. Reactive rollover is **unbounded** — there is no cap on the number of rollovers per `SlackStreamer` instance; a long-running task may open as many continuation blocks as Slack expiries require. Rollover is guarded so that a single expired stream produces exactly one rollover (see the Stream Generation Guard requirement). The new stream SHALL act as a clean continuation: no internal stream state (open groups, task mappings, active-task tracking) carries over to the new block, and the thinking-finalized flag SHALL be reset so the thinking task title can be updated independently on the new block. In-flight task tracking SHALL be re-emitted on the new block so that subsequent `tool_end` events for tasks that were running when rotation occurred are not silently dropped. The system SHALL retain a per-instance ordered list of every `messageTs` the streamer has opened so that callers that need to clean up the streamer's footprint (skip, cancel, top-level repost) can reach every block.

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

### Requirement: Stream Keepalive

The system SHALL periodically send keepalive appends to prevent Slack from expiring the chat stream during idle periods. Keepalive content SHALL target every currently in-progress task that has been running for at least a visible-progress threshold, updating the task's title with a live elapsed-time suffix and appending incremental content to the task's details field to ensure Slack registers the update as activity.

The keepalive timer SHALL NOT run while a deferred stream is uncommitted, since a keepalive append would create the very message deferral withholds. It SHALL start when the stream commits. Once running, keepalive behaves identically for a committed deferred stream and a non-deferred stream.

#### Scenario: Keepalive timer started after stream starts

- **WHEN** a non-deferred `start()` completes successfully (initial append succeeds)
- **THEN** a periodic keepalive timer is started at a fixed interval (15 seconds)

#### Scenario: Keepalive withheld while deferred and uncommitted

- **WHEN** a deferred stream has started but not committed
- **THEN** no keepalive timer is running
- **AND** no keepalive append is emitted regardless of elapsed time

#### Scenario: Keepalive starts on commit

- **WHEN** a deferred stream commits and opens its card
- **THEN** the periodic keepalive timer is started at the same fixed interval

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
- **AND** this applies only while the timer is running — i.e. never to a deferred stream that has not committed

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

### Requirement: Tool Call Progress

The system SHALL display Claude's tool calls as task cards within a plan block, updated in real-time as tools execute. Consecutive same-group tool calls collapse into a single task card; the header title increments a `(<count>)` suffix on every call, and each call appends a detail line below the header up to the group's resolved `maxDetails` cap. The first call that exceeds the cap (i.e. call number `maxDetails + 1`) SHALL append a single `…` overflow marker line in place of its detail. Every subsequent same-group call SHALL continue to advance the header count but SHALL NOT append any further detail line — the marker is emitted exactly once per group, regardless of how many calls overflow the cap. When `maxDetails` is `0`, no detail lines (including the marker) are emitted at all.

#### Scenario: Thinking task lifecycle

- **WHEN** the stream starts
- **THEN** a persistent "thinking" task card is shown in `in_progress` status
- **AND** its title updates to reflect the current tool (e.g., "Reading src/config.ts") when a tool starts
- **AND** its title reverts to "Analyzing..." when a tool completes
- **AND** it is marked `complete` when the stream stops

#### Scenario: Tool call starts

- **WHEN** Claude invokes a tool (e.g., Read, Grep, git_log)
- **THEN** the system appends `task_update` chunks: one updating the thinking task title, one creating a new task card in `in_progress` status with a human-readable title

#### Scenario: Tool call completes successfully

- **WHEN** a tool call returns its result without error
- **THEN** the system appends a `task_update` chunk updating the task card to `complete` status

#### Scenario: Tool call fails

- **WHEN** a tool call returns with `is_error: true`
- **THEN** the system appends a `task_update` chunk updating the task card to `complete` status with " (failed)" appended to the title
- **AND** includes the error message as `details` on the task update

#### Scenario: submit_response excluded from task cards

- **WHEN** Claude calls the `submit_response` tool
- **THEN** no task card is created for that tool call (it is the answer, not a step)

#### Scenario: Grouped detail lines accumulate below the resolved cap

- **WHEN** five consecutive tools join the same open group with a resolved `maxDetails` of `5`
- **THEN** the task card header SHALL read `<title> (5)` and the details SHALL contain exactly five detail lines (one per call)

#### Scenario: A single overflow marker fires at the cap+1 call

- **WHEN** a sixth tool joins the same open group with a resolved `maxDetails` of `5`
- **THEN** the task card header SHALL read `<title> (6)`
- **AND** the system SHALL append exactly one `…` overflow marker line in place of the sixth call's detail
- **AND** the existing five detail lines SHALL remain unchanged

#### Scenario: Subsequent overflow calls add no further detail lines

- **WHEN** a seventh, eighth, or later tool joins the same open group whose cap has already been marked
- **THEN** the system SHALL NOT append any additional detail line for those calls
- **AND** the marker SHALL remain a single `…` entry — it is NOT emitted again per call
- **AND** the header count SHALL continue to advance with each call

#### Scenario: Cap of zero produces a header-only task card

- **WHEN** a group is opened with a resolved `maxDetails` of `0`
- **THEN** the task card SHALL be created with the group's title and no detail lines (no `…` marker either)
- **AND** subsequent calls in the group SHALL increment only the header count

#### Scenario: Re-emission of grouped details respects the cap

- **WHEN** an MCP tool emits `tool_progress` (empty args) followed by `tool_use` (real args) for a call whose ordinal in the group is strictly greater than `maxDetails + 1`
- **THEN** the re-emission SHALL NOT append a new detail line (the marker was already emitted on the boundary call)

#### Scenario: Cap applies independently to separate groups in the same stream

- **WHEN** the stream contains two separate groups (different group keys), each with their own resolved `maxDetails`
- **THEN** each group's detail line count SHALL be governed by its own cap, independent of the other group

### Requirement: Tool Label Registry

The system SHALL load tool label mappings from JSON config files in `data/default_configuration/tool_mapping/` (shipped defaults) and `data/configuration/tool_mapping/` (user overrides), resolving labels through template interpolation with tool arguments.

#### Scenario: Known tool mapped to label

- **WHEN** a tool call is made for a tool with a config entry (e.g., `Read`, `Grep`, `mcp__clack__git_log`)
- **THEN** the task card title uses the configured label template, interpolated with tool arguments (e.g., "Reading config.ts", "Searching codebase", "Reading git history")

#### Scenario: Dynamic label from tool arguments

- **WHEN** a tool call includes arguments that provide context (e.g., `Read` with `file_path`)
- **THEN** the label template interpolates argument values (e.g., "Reading config.ts") with path shortened to last 2 segments

#### Scenario: GitHub MCP tools

- **WHEN** a tool call is prefixed with `mcp__github__`
- **AND** the tool is listed in the GitHub config file
- **THEN** the task card title SHALL use the configured label
- **WHEN** the tool is not listed but the config has a `default` or `group`
- **THEN** the task card title SHALL use the default label or group title

#### Scenario: Null label excludes tool

- **WHEN** a tool is listed in the `hidden` array of its server's config file (e.g., `submit_response`, `report_status`)
- **OR** the tool matches a `conditionalHidden` rule (tool name + argument pattern match)
- **THEN** no task card is created and the thinking task title is not updated

#### Scenario: Unknown tool gets generic label

- **WHEN** Claude calls a tool not in any config file and not matching any MCP server prefix
- **THEN** the task card title SHALL be "Running {toolName}"

#### Scenario: Unknown MCP tool gets server-level fallback

- **WHEN** Claude calls a tool matching `mcp__<server>__<tool>` but no config file exists for that server
- **THEN** the task card title SHALL be "Checking {Server}" with the server name capitalized

#### Scenario: Tool details from config-driven links

- **WHEN** a tool entry has a `link` field that resolves to a valid URL
- **THEN** the task card details SHALL include a clickable Slack link derived from the URL
- **AND** Clack-specific details (channel links, message links) SHALL use hardcoded logic

#### Scenario: Grouped tool details updated on re-emit

- **WHEN** an MCP tool emits `tool_progress` (empty args) followed by `tool_use` (real args)
- **AND** the tool is part of a group
- **THEN** the group's details SHALL be updated with the interpolated label and link from the real args

### Requirement: Answer Delivery

The system SHALL deliver Claude's answer text via `markdownText` and action buttons via `blocks` in the `stopStream` call.

#### Scenario: Answer delivered on stop

- **WHEN** Claude calls `submit_response` and the query completes
- **THEN** the answer text is passed as `markdownText` in `stopStream`
- **AND** only action button blocks (not section blocks) are passed as `blocks` in `stopStream`
- **AND** answer sections are NOT duplicated in blocks (the `markdownText` field renders the full answer)

#### Scenario: Auto actions filtered from buttons

- **WHEN** the response includes actions with `auto: true`
- **THEN** those actions are NOT rendered as buttons in the `stopStream` blocks
- **AND** they are auto-executed separately after the stream stops

#### Scenario: No incremental text streaming

- **WHEN** Claude is processing a query
- **THEN** the system does NOT stream answer text incrementally via `appendStream`
- **AND** only tool progress updates (task cards) are sent during processing
- **AND** the full answer is delivered in the `stopStream` call

### Requirement: Worker Flow Streaming

The Changes Workflow (worker mode) SHALL use the same streaming mechanism to show progress in the change thread.

#### Scenario: Worker stream started

- **WHEN** a change action is triggered (button click or auto-execute)
- **THEN** the action handler creates a `SlackStreamer` in the change thread
- **AND** passes `streamer.handleEvent` to the workflow function

#### Scenario: Worker tool calls shown as task cards

- **WHEN** the worker Claude invokes tools (Read, Write, Edit, Bash, git_push, ensure_pr, etc.)
- **THEN** task cards update live in the change thread stream

#### Scenario: Worker-specific tool labels

- **WHEN** worker tools like `mcp__clack__git_push` or `mcp__clack__ensure_pr` are called
- **THEN** task cards use worker-specific labels (e.g., "Pushing to remote", "Creating pull request")

#### Scenario: report_status excluded from task cards

- **WHEN** the worker Claude calls `report_status`
- **THEN** no task card is created (analogous to `submit_response` exclusion in query mode)

#### Scenario: Worker stream stopped on completion

- **WHEN** the worker completes execution (success or failure)
- **THEN** the stream is stopped with the final status message

#### Scenario: Follow-up actions also stream

- **WHEN** a follow-up action (review, update, merge, close) is triggered in a change thread
- **THEN** the handler creates a new `SlackStreamer` for the follow-up execution

### Requirement: Silent Thinking Mode

The system SHALL support a `silentThinking` mode in `executeAndDeliver` that bypasses the SlackStreamer and posts the final result directly.

#### Scenario: No streamer created when silentThinking

- **WHEN** `executeAndDeliver` is called with `silentThinking: true`
- **THEN** no `SlackStreamer` is created
- **AND** the `onEvent` handler passed to `askClaude` is a no-op

#### Scenario: Direct delivery when silentThinking

- **WHEN** Claude calls `submit_response` during a silent thinking session
- **THEN** the response is posted via `chat.postMessage` directly
- **AND** no streaming task cards or "thinking..." indicators are shown in the channel

#### Scenario: Top-level posting when silentThinking

- **WHEN** a silent thinking session delivers its response
- **THEN** the `chat.postMessage` call SHALL NOT include `thread_ts`
- **AND** the message appears as a top-level message in the target channel

#### Scenario: Error handling when silentThinking

- **WHEN** a silent thinking session encounters an error
- **THEN** the system SHALL NOT post the error to the target channel
- **AND** error reporting follows the caller's error handling (e.g., DM to creator for cron jobs)

#### Scenario: Existing streaming behavior unchanged

- **WHEN** `executeAndDeliver` is called without `silentThinking` (or with `silentThinking: false`)
- **THEN** the system SHALL create a `SlackStreamer` and stream tool progress as before
- **AND** no behavior changes for existing trigger types

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

### Requirement: Task-Card Transport

The system SHALL select how the task card reaches Slack from `config.streaming.taskCardTransport` (fail-fast zod; `"stream"` or `"streamThenUpdate"`; absent → `"stream"`). `"stream"` SHALL behave exactly as the Stream Lifecycle and Reactive Stream Rollover requirements describe. Under `"streamThenUpdate"` the streamer SHALL keep a projection of every task card it has sent (title and status replaced per update, details appended) and SHALL move the card off the chat stream onto `chat.update` edits of the same message, rendered as one Block Kit `plan` block of `task_card` entries (at most 50: the thinking row plus the 49 most recent). The move is a **handover**: it happens at most once per streamer, never opens a second message, and after it every task update, keepalive tick, and the final answer is a `chat.update` of that message.

#### Scenario: Timed handover before Slack seals the stream

- **WHEN** the transport is `streamThenUpdate` and 270 seconds have passed since the card started posting (the start of a non-deferred stream, or the commit of a deferred one)
- **THEN** the streamer SHALL end the chat stream with `chat.stopStream` (a failure there is ignored)
- **AND** SHALL edit the same message with `chat.update`, replacing its content with the projected `plan` block

#### Scenario: Seal before the timer hands over instead of rolling over

- **WHEN** the transport is `streamThenUpdate` and an append fails with `message_not_in_streaming_state` or `message_not_found` while the message `ts` is known
- **THEN** the streamer SHALL NOT open a new chat stream
- **AND** SHALL hand over to `chat.update` on the same message without calling `chat.stopStream`

#### Scenario: Final answer lands on the same message

- **WHEN** `stop({ markdownText?, blocks? })` runs after a handover
- **THEN** the streamer SHALL force-complete in-flight tasks and the thinking row in the projection
- **AND** SHALL issue one final `chat.update` whose blocks are the `plan` block, then a `markdown` block for `markdownText` when given, then the caller's `blocks`
- **AND** `getMessageTs()` SHALL return the original message `ts` and `getAllMessageTss()` SHALL contain only that `ts`

#### Scenario: Update failure falls back like a failed stream

- **WHEN** a `chat.update` of the card fails
- **THEN** the streamer SHALL enter failed state, stop its keepalive, and report `hasFailed`, so callers fall back to `chat.postMessage` as they do for a failed stream

#### Scenario: Default transport schedules no handover

- **WHEN** `taskCardTransport` is absent or `"stream"`
- **THEN** the streamer SHALL NOT schedule a handover and SHALL NOT call `chat.update` for the card
- **AND** a recoverable append failure SHALL roll over per the Reactive Stream Rollover requirement
