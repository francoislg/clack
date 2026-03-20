# streaming-responses Specification

## Purpose
Manage Slack chat streams for Claude queries, displaying real-time tool call progress as task cards and delivering the final answer via stream finalization.

## Requirements

### Requirement: Stream Lifecycle
The system SHALL manage a Slack chat stream for each Claude query, using `chat.startStream` to begin, `chat.appendStream` to send task updates, and `chat.stopStream` to finalize the response with the answer and action buttons.

#### Scenario: Stream started on query begin
- **WHEN** a Claude query begins processing (any trigger mode)
- **THEN** the system starts a chat stream in the target channel/thread with `task_display_mode: "plan"`
- **AND** immediately shows an initial "Acknowledged, working on it..." task card in `in_progress` status

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
- **AND** on completion, the caller detects `hasFailed` and falls back to `chat.postMessage`
- **AND** calls `streamer.stop()` first to clear any loading state

#### Scenario: Cancellation stops stream
- **WHEN** a request is cancelled (e.g., via message edit)
- **THEN** the system stops the stream with a "_Request cancelled._" markdown text

#### Scenario: Stream always cleaned up
- **WHEN** processing completes (success, error, or exception)
- **THEN** the system calls `streamer.stop()` in a `finally` block to prevent orphaned streams
- **AND** `stop()` is idempotent -- safe to call multiple times

### Requirement: Tool Call Progress
The system SHALL display Claude's tool calls as task cards within a plan block, updated in real-time as tools execute.

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
