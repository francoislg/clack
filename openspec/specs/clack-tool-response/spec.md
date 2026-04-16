# clack-tool-response Specification

## Purpose
The `submit_response` MCP tool contract defining how Claude structures user-facing responses with typed sections and interactive actions, rendered as Slack Block Kit messages.

## Requirements

### Requirement: Required Tools Gate on submit_response

The `submit_response` tool SHALL refuse delivery when the current session was configured with one or more `requiredTools` and any of them has not been recorded as called at least once during the run. Required tools are identified by their full MCP-visible name (e.g., `mcp__trivia__submit_answers`). A tool counts as "called" as soon as it appears in the session's `ToolCallRecorder` history, regardless of whether that call succeeded or returned an error.

#### Scenario: No required tools configured

- **WHEN** `submit_response` is called and the session context has no `requiredTools` (undefined or empty array)
- **THEN** the gate is bypassed
- **AND** the tool proceeds with its existing validation (staged intents, block validation, `post_to` dedup, etc.)

#### Scenario: All required tools were called

- **GIVEN** the session was configured with `requiredTools: ["mcp__trivia__submit_answers"]`
- **AND** the tool-call recorder history contains at least one entry with `tool === "mcp__trivia__submit_answers"`
- **WHEN** Claude calls `submit_response`
- **THEN** the gate passes
- **AND** the tool proceeds with its existing validation and delivery

#### Scenario: A required tool was not called

- **GIVEN** the session was configured with `requiredTools: ["mcp__trivia__submit_answers"]`
- **AND** the tool-call recorder history contains no entry with `tool === "mcp__trivia__submit_answers"`
- **WHEN** Claude calls `submit_response`
- **THEN** the tool returns an error result describing the missing tool(s) by exact name (e.g., `"Cannot submit response yet. The following required tool(s) have not been called during this run: mcp__trivia__submit_answers. Call them before submitting."`)
- **AND** does NOT call the deliver callback
- **AND** does NOT record the response as delivered in `responseCapture`
- **AND** the error is recorded via `recordError` so it appears in the tool-call history

#### Scenario: Multiple required tools — some missing

- **GIVEN** the session was configured with `requiredTools: ["mcp__trivia__submit_answers", "mcp__trivia__save_question"]`
- **AND** only `mcp__trivia__submit_answers` appears in the recorder history
- **WHEN** Claude calls `submit_response`
- **THEN** the error result lists only the missing tool name(s) (e.g., `mcp__trivia__save_question`)
- **AND** does not mention tools that were already called

#### Scenario: Required tool was called and returned an error

- **GIVEN** the session was configured with `requiredTools: ["mcp__trivia__submit_answers"]`
- **AND** the recorder contains an entry for `mcp__trivia__submit_answers` whose result is an error
- **WHEN** Claude calls `submit_response`
- **THEN** the gate passes (the tool was called, which is the sole requirement)
- **AND** the tool proceeds with its existing validation and delivery

#### Scenario: Gate runs before skip-response validation

- **WHEN** `submit_response` is called with `skip_response: true` and the session has unmet `requiredTools`
- **THEN** the gate blocks delivery regardless of skip mode
- **AND** the error returned identifies the missing required tool(s)

### Requirement: Required Tools Supplied via Session Context

The `requiredTools` list SHALL be provided per-session through the processing context pipeline (`ProcessMessageParams` → `ProcessingContext` → `QueryToolContext`), threaded into `SubmitResponseDeps`. It is not global state and not plugin-owned.

#### Scenario: Cron trigger populates required tools

- **WHEN** a cron job with `requiredTools: ["mcp__trivia__submit_answers"]` fires
- **THEN** the scheduler passes that list into `processMessage` as `ProcessMessageParams.requiredTools`
- **AND** the list flows through to the `submit_response` tool's gating logic for that session

#### Scenario: Non-cron triggers pass the field through unchanged

- **WHEN** a DM, mention, reaction, or auto-respond trigger invokes `processMessage` without supplying `requiredTools`
- **THEN** the field remains undefined
- **AND** the gate is bypassed for that session

#### Scenario: Unknown tool name in requiredTools is diagnosable

- **GIVEN** a session is configured with `requiredTools: ["mcp__typo__notatool"]`
- **AND** no tool with that name exists in the session's available tools
- **WHEN** query tool assembly detects the mismatch
- **THEN** the system logs a warning identifying the unknown required tool name
- **AND** the session still runs (assembly does not fail)
- **AND** the gate will block `submit_response` indefinitely for this session — the unknown tool cannot be called, so the gate cannot be satisfied
- **AND** each `submit_response` attempt returns the gate error listing the unknown tool name, which surfaces the misconfiguration via Claude's error feedback and via the operator-visible warning log

### Requirement: submit_response Tool

The system SHALL provide a `submit_response` MCP tool that defines the user-facing response with structured content and actions, and delivers it to Slack. The tool also supports a `skip_response` mode that declines to answer. The tool optionally accepts emoji reactions to add to the posted message.

#### Scenario: Basic response with sections

- **WHEN** Claude calls `submit_response` with a sections array
- **THEN** each section contains an optional `title` (string) and a required `body` (string, markdown)
- **AND** the tool validates the rendered blocks
- **AND** the tool delivers the response to Slack via the injected deliver callback
- **AND** captures the payload for session persistence
- **AND** returns a delivery confirmation to Claude

#### Scenario: Response with reactions

- **WHEN** Claude calls `submit_response` with a `reactions` array of emoji names
- **AND** the response is delivered successfully
- **THEN** the delivery layer adds each emoji as a reaction on the posted response message
- **AND** reactions are added in parallel after delivery

#### Scenario: Reaction with invalid emoji

- **WHEN** a reaction emoji name is invalid or does not exist
- **THEN** the system logs a warning
- **AND** the overall response delivery is NOT affected
- **AND** other valid reactions in the array are still added

#### Scenario: Reaction already added

- **WHEN** a reaction emoji was already added to the message (e.g., duplicate in the array)
- **THEN** the system silently ignores the `already_reacted` error

#### Scenario: Reactions without delivery

- **WHEN** Claude calls `submit_response` with `reactions` but no `deliver` callback is configured
- **THEN** the reactions are ignored (no Slack client to add them)
- **AND** the response is captured normally

#### Scenario: Delivery returns message timestamp

- **WHEN** the delivery callback posts a message to Slack
- **THEN** the delivery result includes the posted message's `ts` field
- **AND** the `ts` is used by the delivery layer to target reactions

### Requirement: Send to Thread Action Type

The system SHALL support a `post_to` action type (renamed from `send_to_thread`) that posts specific content to a channel or thread. Each button carries its own content, persisted at creation time.

#### Scenario: post_to action with content

- **WHEN** Claude calls `submit_response` with `{ type: "post_to", content: "<text>" }` and optional `label`
- **THEN** the system persists the `content` as a dedicated entry in session snapshots keyed by a unique ID
- **AND** if `auto` is not `true`, the Slack UI renders a primary-styled button (default label: "Post to thread")
- **AND** the button value encodes the session ID and the content entry ID

#### Scenario: post_to content is required

- **WHEN** Claude calls `submit_response` with a `post_to` action that omits `content`
- **THEN** the tool returns a validation error indicating `content` is required
- **AND** delivery is NOT attempted

#### Scenario: Multiple post_to buttons with different content

- **WHEN** Claude calls `submit_response` with multiple `post_to` actions, each with distinct `content`
- **THEN** each action gets its own persisted content entry with a unique ID
- **AND** clicking any button posts only that button's content, not the full response

#### Scenario: post_to action rendering

- **WHEN** a response includes a `post_to` action without `auto: true`
- **THEN** the button is rendered with action_id `clack_post_to`
- **AND** the button value encodes the session ID and content entry ID

#### Scenario: post_to with auto true is not rendered as button

- **WHEN** a response includes a `post_to` action with `auto: true`
- **THEN** the action is NOT rendered as a button
- **AND** the action is handled by auto-execute after delivery

#### Scenario: Backward compatibility with send_to_thread action ID

- **WHEN** a user clicks a button with the legacy `clack_dm_send_to_thread` action ID
- **THEN** the system handles it identically to `clack_post_to`

### Requirement: Continuation Action Types

The system SHALL support continuation actions that resume the conversation with new user input.

#### Scenario: Followup action

- **WHEN** `submit_response` includes `{ type: "followup", label: "<text>", prompt: "<question>" }`
- **THEN** the Slack UI renders a button with the provided label
- **AND** clicking re-invokes Claude with the `prompt` as a new question in the session

#### Scenario: Choice action

- **WHEN** `submit_response` includes one or more `{ type: "choice", label: "<text>", value: "<value>" }` actions with optional `description`
- **THEN** the Slack UI renders each choice as a button with the label and optional description subtitle
- **AND** clicking injects "The user chose: {value}" into the conversation
- **AND** re-invokes Claude to continue from where it left off

#### Scenario: Multiple choices in one response

- **WHEN** `submit_response` includes multiple choice actions
- **THEN** all choice buttons are rendered in the actions row
- **AND** only one choice can be selected (clicking any choice dismisses the message and continues)

### Requirement: Change Thread Follow-Up Action Types

The system SHALL support follow-up actions in change thread contexts.

#### Scenario: Review action with ref and optional auto

- **WHEN** `submit_response` includes `{ type: "review", ref: "<id>" }` with optional `auto`
- **THEN** if `auto` is `true`, the system auto-executes the review workflow after posting
- **AND** if `auto` is not `true`, the Slack UI renders a button for user confirmation

#### Scenario: Merge action with ref and optional auto

- **WHEN** `submit_response` includes `{ type: "merge", ref: "<id>" }` with optional `auto`
- **THEN** if `auto` is `true`, the system auto-executes the merge workflow after posting
- **AND** if `auto` is not `true`, the Slack UI renders a primary-styled button for user confirmation

#### Scenario: Update action with ref and optional auto

- **WHEN** `submit_response` includes `{ type: "update", ref: "<id>" }` with optional `auto`
- **THEN** if `auto` is `true`, the system auto-executes the update workflow after posting
- **AND** if `auto` is not `true`, the Slack UI renders a button for user confirmation

#### Scenario: Close action with ref and optional auto

- **WHEN** `submit_response` includes `{ type: "close", ref: "<id>" }` with optional `auto`
- **THEN** if `auto` is `true`, the system auto-executes the close workflow after posting
- **AND** if `auto` is not `true`, the Slack UI renders a danger-styled button for user confirmation

### Requirement: Structured Response Rendering

The system SHALL render `submit_response` output as Slack Block Kit messages.

#### Scenario: Sections rendered as mrkdwn blocks

- **WHEN** the response includes sections
- **THEN** each section is rendered as a Slack section block
- **AND** section `title` is rendered as bold text preceding the body
- **AND** section `body` is converted from markdown to Slack mrkdwn format
- **AND** long sections are split at the 3000-character Slack limit

#### Scenario: Actions rendered as buttons

- **WHEN** the response includes actions
- **THEN** a divider separates content from actions
- **AND** each action is rendered as a Slack button in an actions block
- **AND** button style reflects type: `change`, `merge`, and `post_to` are primary, `close` is danger, others are default
- **AND** removed types (`accept`, `reject`) no longer have style mappings
- **AND** button `value` encodes the session ID and action metadata for handler resolution

#### Scenario: Button limit handling

- **WHEN** the response includes more than 5 actions
- **THEN** actions are split across multiple Slack actions blocks (max 5 buttons per block)

### Requirement: Block Validation Before Delivery

The `submit_response` tool SHALL validate the rendered Slack blocks against known Block Kit constraints before attempting delivery.

#### Scenario: Section text within limits

- **WHEN** Claude calls `submit_response` with sections whose rendered mrkdwn text is within Slack's 3000-character section limit
- **THEN** validation passes and delivery is attempted

#### Scenario: Section text exceeds limit

- **WHEN** Claude calls `submit_response` with a section whose rendered mrkdwn text exceeds 3000 characters (after markdown-to-mrkdwn conversion and splitting)
- **THEN** the tool returns an error identifying the oversized section (by index and title if present)
- **AND** includes the current character count and the limit
- **AND** does NOT attempt delivery
- **AND** Claude can fix the section and retry `submit_response`

#### Scenario: Button label exceeds limit

- **WHEN** Claude calls `submit_response` with an action whose rendered button label exceeds 75 characters
- **THEN** the tool returns an error identifying the action (by index and type)
- **AND** includes the current character count and the limit

#### Scenario: Total block count exceeds limit

- **WHEN** the rendered blocks (sections + divider + action rows) exceed 50 total blocks
- **THEN** the tool returns an error indicating the block count and the 50-block limit
- **AND** suggests reducing the number of sections

#### Scenario: Multiple validation errors

- **WHEN** multiple block constraints are violated
- **THEN** the tool returns all errors in a single response
- **AND** Claude can address all issues before retrying

### Requirement: post_top_level Flag on submit_response

The `submit_response` tool SHALL accept an optional `post_top_level: boolean` field when the session's trigger type supports channel-top-level delivery. When set to `true`, the response is delivered as a top-level channel message (no `thread_ts`) instead of a thread reply, and any pre-existing thinking indicator in the thread is removed.

#### Scenario: post_top_level field is exposed for supported triggers

- **WHEN** the `submit_response` tool schema is constructed for a session whose trigger type is `autoRespond`, `threadReply`, `mentions`, or `reactions`
- **THEN** the `post_top_level` field is included in the schema
- **AND** its description names canonical use cases (auto-respond rules that direct to the channel, announcement-style broadcasts)

#### Scenario: post_top_level field is omitted for triggers without channel top-level

- **WHEN** the trigger type is `directMessages`, `scheduled`, or the Changes Workflow worker mode
- **THEN** the `post_top_level` field is NOT included in the schema
- **AND** Claude cannot set it

#### Scenario: post_top_level: true routes delivery to channel top-level

- **GIVEN** a session with a supported trigger type and a streamer posting a thinking indicator in the thread
- **WHEN** Claude calls `submit_response` with `post_top_level: true` and a normal response
- **THEN** the deliver callback receives `postTopLevel: true`
- **AND** the streamer's in-thread message is deleted before the final post
- **AND** the response is posted to the session's channel via `chat.postMessage` without a `thread_ts`
- **AND** the tool's success result includes `postedTopLevel: true`

#### Scenario: post_top_level: false or unset preserves thread delivery

- **WHEN** Claude calls `submit_response` without `post_top_level` (or with `post_top_level: false`)
- **THEN** the deliver callback is called without the `postTopLevel` flag (or with it undefined)
- **AND** the response is finalized in the thread via the streamer, as before

### Requirement: Duplicate Post_to Rejection When post_top_level Is Set

The `submit_response` tool SHALL reject a response that sets `post_top_level: true` and also includes a `post_to` action targeting the session's channel without a `thread_ts` — that combination would duplicate the primary delivery. The existing `topLevelDeliveryChannel` validation is extended to recognize the session's channel as the effective top-level target when `post_top_level: true`.

#### Scenario: post_to targeting the same channel without thread_ts is rejected

- **GIVEN** a session whose channel is `C_SESSION`
- **WHEN** Claude calls `submit_response` with `post_top_level: true` AND a `post_to` action with `channel: "C_SESSION"` and no `thread_ts`
- **THEN** the tool returns an error indicating the `post_to` would duplicate the top-level post
- **AND** does NOT call the deliver callback
- **AND** does NOT record the response as delivered

#### Scenario: post_to targeting a DIFFERENT channel is allowed

- **GIVEN** a session whose channel is `C_SESSION`
- **WHEN** Claude calls `submit_response` with `post_top_level: true` AND a `post_to` action with `channel: "C_OTHER"` and no `thread_ts`
- **THEN** the tool accepts the response
- **AND** delivers the primary response to `C_SESSION` top-level
- **AND** the `post_to` is rendered as a button/auto action for `C_OTHER`

#### Scenario: post_to targeting the same channel WITH thread_ts is allowed

- **GIVEN** a session whose channel is `C_SESSION`
- **WHEN** Claude calls `submit_response` with `post_top_level: true` AND a `post_to` action with `channel: "C_SESSION"` and `thread_ts: "1234.5678"`
- **THEN** the tool accepts the response
- **AND** the `post_to` is not treated as a duplicate (different destination: a specific thread vs channel top-level)

### Requirement: DeliverFn Supports postTopLevel Routing

The `DeliverFn` type SHALL accept an optional `postTopLevel` boolean. When `true`, the implementation SHALL delete the streamer's in-thread message (if any) and post via `chat.postMessage` without a `thread_ts`. When `false` or absent, behavior matches the prior thread-reply delivery.

#### Scenario: postTopLevel routes via chat.postMessage without thread_ts

- **WHEN** the deliver callback is invoked with `postTopLevel: true`
- **THEN** the implementation calls `client.chat.postMessage` with the session's `channel` and without `thread_ts`
- **AND** the streamer (if present) is stopped and its message is deleted before the post

#### Scenario: postTopLevel delivery failure surfaces to the caller

- **WHEN** `chat.postMessage` throws during a top-level post
- **THEN** the deliver callback returns `{ ok: false, error }` with the error message
- **AND** the caller (submit_response) returns a `delivery_failed` tool error to Claude
