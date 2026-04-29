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

### Requirement: Claude-Authored Block Kit Responses

The `submit_response` tool SHALL accept a `blocks: Block[]` field where `Block` is a curated subset of Slack Block Kit types. Claude authors the response structure directly by selecting block types appropriate to the content. The curated subset is: `divider`, `header`, `section` (with optional `fields`), `context`, `image`, `markdown`. Blocks outside this subset are rejected at the tool boundary. `actions` blocks SHALL NOT appear in the `blocks` array — action buttons are driven by the structured `actions: Action[]` field on `submit_response` and rendered by Clack into Slack `actions` blocks at delivery time. Tabular content SHALL NOT appear inside `blocks`; tables are authored via the top-level `table` parameter (see *Top-Level Table Parameter*).

#### Scenario: submit_response accepts a valid blocks array

- **WHEN** Claude calls `submit_response` with a `blocks` array containing one or more blocks of allowed types, each conforming to Slack's Block Kit schema
- **THEN** validation passes
- **AND** the blocks are prepared (markdown converted on section/context as before, markdown-block text passed through) and delivered via the deliver callback

#### Scenario: submit_response rejects a disallowed block type

- **WHEN** Claude calls `submit_response` with a block whose `type` is not in the curated subset (e.g., `input`, `rich_text`, `file`, `video`, `alert`, `card`)
- **THEN** the tool returns a validation error naming the disallowed type and listing the allowed types
- **AND** the deliver callback is not called

#### Scenario: submit_response rejects a `table` block inside the blocks array

- **WHEN** Claude calls `submit_response` with a block of `type: "table"` inside the `blocks` array
- **THEN** the schema parse rejects the block as a disallowed type
- **AND** the error message identifies the offending block index and the disallowed type
- **AND** the deliver callback is not called

#### Scenario: submit_response rejects an `actions` block in the blocks array

- **WHEN** Claude calls `submit_response` with a block of `type: "actions"` inside the `blocks` array
- **THEN** the tool returns a validation error explaining that action buttons are driven by the structured `actions` field on `submit_response`, not authored as `actions` blocks in `blocks`
- **AND** the error points Claude at the structured `actions: Action[]` field as the correct path
- **AND** the deliver callback is not called

#### Scenario: submit_response rejects an empty blocks array

- **WHEN** Claude calls `submit_response` with `blocks: []` without `skip_response: true`
- **THEN** the tool returns a validation error requiring at least one block

#### Scenario: submit_response with skip_response omits blocks entirely

- **WHEN** Claude calls `submit_response` with `skip_response: true` and no `blocks` field (or an empty array)
- **THEN** the tool accepts the call and records a skipped response
- **AND** the `blocks` field is not required for the skip path

### Requirement: Centralized Block Validation With Friendly Errors

The `submit_response` tool SHALL validate every block against per-type Slack Block Kit limits before delivery. Validation errors SHALL identify the failing field, current measurement, and applicable limit in a form Claude can act on to correct and retry.

#### Scenario: header text exceeds 150 chars

- **WHEN** a `header` block's `text.text` exceeds 150 characters
- **THEN** the tool returns a validation error naming the block index, field (`text.text`), current length, and the 150-char limit
- **AND** does not call the deliver callback

#### Scenario: context block has too many elements

- **WHEN** a `context` block has more than 10 elements
- **THEN** the tool returns a validation error naming the block index, element count, and the 10-element limit

#### Scenario: context element text exceeds 75 chars

- **WHEN** a `context` element's `text` exceeds 75 characters
- **THEN** the tool returns a validation error naming the block index, element index, current length, and the 75-char limit

#### Scenario: section text is split by prepareBlocks before validation

- **GIVEN** Claude submits a `section` block whose `text.text` exceeds 3000 characters
- **WHEN** the tool processes the blocks
- **THEN** `prepareBlocks` splits the oversize text into multiple section blocks, each ≤ 3000 characters, before validation
- **AND** validation passes on the split output
- **AND** the deliver callback receives the multi-block result

#### Scenario: section text cannot be split (e.g., unbreakable single run)

- **WHEN** `prepareBlocks` cannot split a `section` block's `text.text` below the 3000-char limit (e.g., a single unbroken token exceeds the limit)
- **THEN** the tool returns a validation error naming the block index, current length, and the 3000-char limit

#### Scenario: section fields outside 2–10 range

- **WHEN** a `section` block has `fields` with fewer than 2 or more than 10 items
- **THEN** the tool returns a validation error naming the count and the 2–10 range

#### Scenario: section field text exceeds 2000 chars

- **WHEN** any element in a `section` block's `fields` exceeds 2000 characters
- **THEN** the tool returns a validation error naming the block index, field index, current length, and the 2000-char limit

#### Scenario: image block missing alt_text or image_url

- **WHEN** an `image` block has an empty or missing `alt_text` or `image_url`
- **THEN** the tool returns a validation error naming the missing field

#### Scenario: total block count exceeds 50

- **GIVEN** validation runs AFTER `prepareBlocks` has split oversize sections AND AFTER action-button blocks have been appended to the content blocks
- **WHEN** the resulting total block count exceeds 50
- **THEN** the tool returns a validation error naming the total count, the component parts (content blocks, split-added blocks, action-button blocks), and the 50-block limit

#### Scenario: action-button blocks contribute to the 50-block budget

- **GIVEN** Claude submits 48 content blocks plus 10 actions that render as 2 action-button blocks (Slack groups buttons in rows of 5)
- **WHEN** validation runs after action appending
- **THEN** the total is 50 (48 + 2) — validation passes
- **AND** a submission of 49 content blocks plus the same 10 actions (total 51) fails validation

### Requirement: Message Preamble Renders Above Blocks

The `message` conversational-preamble field on `submit_response` SHALL, when provided, render as a prepended section block ABOVE the `blocks` array in the delivered Slack message. The preamble is not included in shareable content (`post_to` actions) — only in the displayed response. Reactions added via the `reactions` field apply to the posted message as a whole, unchanged by the presence of `message` or the block count.

#### Scenario: submit_response with both message and blocks

- **WHEN** Claude calls `submit_response` with `message: "Here's the update you asked for."` and a non-empty `blocks` array
- **THEN** the delivered Slack message contains a section block carrying the message text first
- **AND** the authored `blocks` array follows in order
- **AND** the total block count (message prepend + authored blocks + appended action blocks) is subject to the 50-block validation limit

#### Scenario: submit_response with blocks but no message

- **WHEN** Claude calls `submit_response` with `blocks` and no `message`
- **THEN** the delivered message contains the authored `blocks` only (plus any appended action blocks)
- **AND** no synthetic preamble is prepended

#### Scenario: message is excluded from post_to content

- **GIVEN** Claude submits a response with `message` set and a `post_to` action
- **WHEN** the user clicks the `post_to` button
- **THEN** only the `post_to.blocks` payload is posted to the target thread
- **AND** the `message` preamble is NOT included in the shared content

### Requirement: Reactions Applied To Block-Based Responses

The `reactions` field on `submit_response` SHALL continue to apply to the posted Slack message after delivery, regardless of block structure. Reactions target the message `ts` returned by the delivery, not individual blocks.

#### Scenario: reactions attached to a block-based response

- **WHEN** Claude calls `submit_response` with `blocks` and `reactions: ["white_check_mark", "thumbsup"]`
- **AND** delivery succeeds
- **THEN** each emoji is added as a reaction on the posted message via `reactions.add`
- **AND** reactions target the message `ts`, not any specific block

#### Scenario: invalid reactions are silently ignored

- **WHEN** a reaction name in the array is invalid or does not exist in the workspace
- **THEN** the system logs a warning
- **AND** other valid reactions are still applied
- **AND** the overall response delivery is NOT affected

### Requirement: Optional Slack Block Kit Fields Are Preserved

The block validator SHALL preserve optional Slack Block Kit fields on allowed block types (e.g., `block_id` for uniqueness/targeting, `confirm` dialogs on buttons, `accessibility_label` on elements) rather than stripping or rejecting them. The curated-type allowlist constrains which *block types* are accepted; it does not constrain which *fields* a block carries within an allowed type. This keeps the system aligned with Decision 2 (authentic Slack Block Kit) so Claude can use Block Kit features without Clack becoming a gatekeeper on every field Slack ships.

#### Scenario: section block with block_id is preserved

- **WHEN** Claude submits a `section` block that includes a `block_id: "intro_section"` field
- **THEN** validation passes
- **AND** the prepared output retains the `block_id` field verbatim
- **AND** the Slack API call includes the `block_id` on the posted block

#### Scenario: button with confirm dialog is preserved

- **WHEN** Claude submits an `actions` block whose button includes a `confirm: { title, text, confirm, deny }` Slack Block Kit confirmation dialog
- **THEN** validation passes
- **AND** the `confirm` payload is delivered on the button unchanged

#### Scenario: unknown block type is still rejected

- **GIVEN** the passthrough behavior for optional fields
- **WHEN** Claude submits a block whose `type` is outside the curated subset (e.g., `input`, `rich_text`, `file`, `video`)
- **THEN** validation still rejects the block, as defined by the "Claude-Authored Block Kit Responses" requirement
- **AND** passthrough applies only to optional fields *within* allowed block types, never to disallowed block types themselves

#### Scenario: prepareBlocks does not recurse into passthrough fields

- **GIVEN** a block carries a passthrough optional field whose value happens to contain text resembling internal markdown (e.g., a `block_id: "**bold**"` that Claude chose)
- **WHEN** `prepareBlocks` runs
- **THEN** the passthrough field value is NOT transformed by `convertMarkdownToSlack`
- **AND** only text on schema-known fields (`section.text.text`, `header.text.text`, `context.elements[].text`) is converted
- **AND** the passthrough field reaches Slack byte-identical to what Claude authored

### Requirement: post_to Actions Carry Blocks

The `post_to` action SHALL carry a `blocks: Block[]` payload representing the shareable response content. The legacy `content: string` field is removed. The action MAY additionally carry optional `actions` (rendered as buttons on the cross-posted message) and `reactions` (applied to the cross-posted message after delivery), with semantics defined in the *post_to Carries Optional Actions* and *post_to Carries Optional Reactions* requirements. When the user clicks the `post_to` button, the stored blocks (and any persisted `actions` and `reactions`) are prepared and posted via `chat.postMessage` with the blocks attached and reactions applied after.

#### Scenario: post_to action with blocks is accepted

- **WHEN** Claude includes a `post_to` action with a valid `blocks` array
- **THEN** the tool validates the blocks using the same rules as the response body
- **AND** persists the blocks (along with any `actions`/`reactions` present) to the snapshot store under the action's snapshot ID

#### Scenario: post_to action with invalid blocks is rejected

- **WHEN** Claude includes a `post_to` action whose blocks fail validation
- **THEN** the tool returns a validation error identifying the action index and the block violation
- **AND** does not deliver the primary response

#### Scenario: post_to button click posts persisted blocks

- **GIVEN** a `post_to` action snapshot persisted with `{blocks}` (and optional `actions`/`reactions`) at a snapshot ID
- **WHEN** the user clicks the button
- **THEN** the handler loads the snapshot, calls `prepareBlocks`, renders any `actions` as button blocks, posts the result via `chat.postMessage` to the target channel and thread, and applies any `reactions` after the post returns

#### Scenario: post_to button click with unparseable snapshot surfaces an expired error

- **GIVEN** a `post_to` action snapshot in the legacy `{text, sections}` shape (e.g., created before this change)
- **WHEN** the user clicks the button
- **THEN** the handler surfaces a friendly "link expired" error to the user rather than attempting delivery

### Requirement: Shared Message-Content Schema Across submit_response and post_to

The `submit_response` tool and the `post_to` action SHALL accept the same message-content surface — `blocks` (required), `actions` (optional/required per surface rules below), and `reactions` (optional) — defined once as a shared schema fragment and spread into both schemas. Adding a new message-content field SHALL update both surfaces without code duplication.

#### Scenario: post_to accepts blocks, actions, and reactions

- **WHEN** Claude calls `submit_response` with a `post_to` action carrying `blocks`, `actions`, and `reactions` arrays
- **THEN** the tool validates each field through the same validators used for the top-level `submit_response` fields
- **AND** persists all three on the per-button snapshot
- **AND** returns success on the deliver path

#### Scenario: top-level submit_response continues to accept the same fields

- **WHEN** Claude calls `submit_response` with top-level `blocks`, `actions`, and `reactions`
- **THEN** the tool's behavior is unchanged from today
- **AND** the fields are validated and delivered exactly as before

#### Scenario: a future content field is added in one place

- **GIVEN** a future change adds a new content field (e.g., `mentions`) to the shared `messageContentFields` fragment
- **WHEN** the change is implemented
- **THEN** both `submit_response` and `post_to.actions` automatically gain the field at the schema boundary, with no schema duplication

### Requirement: post_to Carries Optional Reactions

The `post_to` action SHALL accept an optional `reactions: string[]` field. When the `post_to` is delivered (auto-execute path or button-click path), the reactions SHALL be added to the cross-posted message via `client.reactions.add` using the same helper, error handling, and silent-ignore semantics as the top-level `submit_response.reactions` field.

#### Scenario: auto-path post_to with reactions adds reactions to the cross-posted message

- **GIVEN** Claude submits `submit_response` with `{ type: "post_to", auto: true, channel: "C123", blocks, reactions: ["white_check_mark"] }`
- **WHEN** the auto-execute handler posts the cross-posted message
- **THEN** the post returns a message timestamp
- **AND** the handler calls `addDeliveryReactions(client, "C123", ts, ["white_check_mark"])`
- **AND** each emoji is added as a reaction on the cross-posted message

#### Scenario: button-click post_to with persisted reactions adds reactions on click

- **GIVEN** Claude submits `submit_response` with a `post_to` action whose snapshot persists `{ blocks, reactions: ["thumbsup"] }`
- **WHEN** the user clicks the rendered button
- **THEN** the handler reads `snapshot.reactions` and forwards it to `postAnswerToChannel`
- **AND** after the cross-posted message is posted, each emoji is added as a reaction

#### Scenario: invalid reactions on post_to are silently ignored

- **WHEN** a `reactions` entry on a `post_to` action is invalid (e.g., unknown emoji)
- **THEN** the system logs a warning and continues
- **AND** the cross-post itself is NOT affected
- **AND** other valid reactions are still applied

#### Scenario: post_to without reactions does not call reactions.add

- **WHEN** a `post_to` action omits the `reactions` field (or provides an empty array)
- **THEN** the handler does NOT call `addDeliveryReactions`
- **AND** the cross-posted message is delivered with no reactions

### Requirement: post_to Carries Optional Actions

The `post_to` action SHALL accept an optional `actions: Action[]` field. When present, the actions SHALL be rendered as Slack action buttons on the cross-posted message via `getResponseActionBlocks`, using the **original session's ID** so click handlers route back to the original session's `intentStore` and snapshot store. The same action variants accepted at the top level (`followup`, `choice`, `change`, `config_update`, `update`) SHALL be accepted inside `post_to.actions`, with one exception: nested `post_to` SHALL be rejected.

#### Scenario: post_to with followup action renders a button on the cross-posted message

- **GIVEN** Claude submits `submit_response` with `post_to.actions: [{ type: "followup", label: "Tell me more", prompt: "..." }]`
- **WHEN** the cross-posted message is delivered (either path)
- **THEN** the rendered Slack message includes an action block with the followup button
- **AND** the button's action_id matches the existing `clack_followup_<index>` pattern
- **AND** the button's value encodes the original session ID

#### Scenario: clicking a cross-posted ref-based action resolves against the original session

- **GIVEN** Claude staged a `propose_change` intent in session S, then submitted `submit_response` with `post_to.actions: [{ type: "change", ref: "<refId>" }]`
- **WHEN** a user clicks the rendered button on the cross-posted message
- **THEN** the click handler decodes the value, resolves session S, and looks up the ref in S's `intentStore`
- **AND** the change workflow starts as if the button had been clicked in S's original thread

#### Scenario: clicking a cross-posted followup re-engages the original session

- **GIVEN** a cross-posted message with a `followup` button whose value encodes session S
- **WHEN** a user clicks the button
- **THEN** Clack re-invokes Claude in session S with the followup prompt
- **AND** the response is delivered in S's original channel/thread, not the cross-posted location

#### Scenario: nested post_to inside post_to.actions is rejected

- **WHEN** Claude submits `submit_response` with `post_to.actions: [{ type: "post_to", blocks: [...] }]`
- **THEN** the tool returns a validation error naming the offending action index
- **AND** the error message states that nested `post_to` is not supported
- **AND** delivery is NOT attempted

#### Scenario: post_to without actions delivers without buttons

- **WHEN** a `post_to` action omits the `actions` field (or provides an empty array)
- **THEN** the cross-posted message has no action block
- **AND** delivery proceeds with `blocks` only (plus reactions if present)

### Requirement: post_to.actions Validated Identically To Top-Level Actions

The validators that today walk `submit_response.actions` SHALL also walk every `post_to.actions` array. Specifically, `validateRefActions`, `validateActionButtonLabels`, and `validateStagedIntentsCoverage` SHALL treat actions inside `post_to.actions` as first-class participants in their checks.

#### Scenario: ref inside post_to.actions is checked against the intent store

- **WHEN** Claude submits `submit_response` with `post_to.actions: [{ type: "change", ref: "<unknown-ref>" }]`
- **THEN** `validateRefActions` returns an error indicating the unknown ref and naming the offending action path (e.g., `actions[i].actions[j]`)
- **AND** delivery is NOT attempted

#### Scenario: button label inside post_to.actions exceeds Slack's 75-char limit

- **WHEN** a button label inside `post_to.actions` exceeds 75 characters
- **THEN** `validateActionButtonLabels` returns an error naming the offending action path and the label length
- **AND** delivery is NOT attempted

#### Scenario: staged intent placed inside post_to.actions counts toward coverage

- **GIVEN** Claude staged a `propose_change` intent (ref X) earlier in the run
- **WHEN** Claude submits `submit_response` with `post_to.actions: [{ type: "change", ref: "X" }]` and no top-level reference to X
- **THEN** `validateStagedIntentsCoverage` accepts the response (the intent is covered by a `post_to.actions` entry)
- **AND** delivery proceeds

### Requirement: post_to Snapshot Captures actions and reactions

The per-button snapshot persisted for each `post_to` action SHALL store `actions` and `reactions` alongside `text` and `blocks` so the button-click delivery path can replay them after an arbitrary delay between submit time and click time.

#### Scenario: snapshot includes actions and reactions when present

- **WHEN** `submit_response` persists a snapshot for a `post_to` action that has `actions` and `reactions`
- **THEN** the snapshot record includes both fields verbatim
- **AND** the snapshot ID stored on the rendered button resolves to that record

#### Scenario: snapshot omits actions and reactions when absent

- **WHEN** `submit_response` persists a snapshot for a `post_to` action that omits `actions` and `reactions`
- **THEN** the snapshot record contains `text` and `blocks` only (no spurious empty arrays)

#### Scenario: button-click delivery replays snapshot actions and reactions

- **GIVEN** a snapshot persisted with `{ blocks, actions, reactions }`
- **WHEN** the user clicks the corresponding button
- **THEN** the handler renders `actions` as button blocks, posts the combined message, and applies `reactions` after delivery

### Requirement: addDeliveryReactions Helper Is Shared Across Outbound Surfaces

The reaction-application helper that today lives inside `src/slack/handlers/handlerResponse.ts` SHALL be exported from a shared module (`src/slack/messageReactions.ts`) and consumed by both the `submit_response` delivery path and the `post_to` delivery paths. No outbound surface SHALL reimplement reaction-application logic.

#### Scenario: submit_response delivery uses the shared helper

- **WHEN** the streamer/fallback delivery path applies reactions after posting
- **THEN** it imports `addDeliveryReactions` from `src/slack/messageReactions.ts`

#### Scenario: post_to delivery (auto + button) uses the shared helper

- **WHEN** the auto-execute handler or the button-click handler applies reactions to the cross-posted message
- **THEN** it imports `addDeliveryReactions` from `src/slack/messageReactions.ts`

#### Scenario: a future change to reaction error handling lands in one place

- **GIVEN** a future change wants to alter how reaction-application errors are logged or retried
- **WHEN** the change is implemented in `src/slack/messageReactions.ts`
- **THEN** all outbound surfaces inherit the new behavior automatically

### Requirement: Nested post_to Is Rejected

The `post_to` action SHALL NOT contain a nested `post_to` action inside its `actions` array. The validator SHALL reject any such configuration with an actionable error.

#### Scenario: nested post_to fails validation

- **WHEN** Claude submits `submit_response` whose `actions` includes a `post_to` action whose own `actions` includes another `post_to`
- **THEN** the tool returns a validation error identifying the offending action path
- **AND** the message states that nested `post_to` is not supported and suggests using a separate `post_to` at the top level

#### Scenario: top-level post_to remains valid

- **WHEN** Claude submits `submit_response` with one or more top-level `post_to` actions, each carrying its own `blocks`/`actions`/`reactions`
- **THEN** all top-level `post_to` actions are accepted
- **AND** the recursion check applies only to actions *inside* a `post_to.actions` array

### Requirement: Centralized Block Handling Across Outbound Surfaces

All Claude-authored outbound surfaces SHALL consume the central `src/slack/blocks.ts` module for block schema, validation, and preparation. No outbound surface SHALL implement its own block validation or markdown conversion.

#### Scenario: submit_response uses the central module

- **WHEN** `submit_response` processes a `blocks` array
- **THEN** it calls `validateBlocks` from `src/slack/blocks.ts` for validation
- **AND** calls `prepareBlocks` from the same module for markdown conversion and text splitting before delivery

#### Scenario: post_to handler uses the central module

- **WHEN** the `post_to` button handler prepares a persisted blocks payload for posting
- **THEN** it calls `prepareBlocks` from `src/slack/blocks.ts` rather than any local preparation logic

#### Scenario: plugin SDK scheduled-message delivery uses the central module

- **WHEN** a scheduled message is delivered via the plugin SDK path
- **THEN** the delivery code calls `validateBlocks` and `prepareBlocks` from `src/slack/blocks.ts` before posting

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

### Requirement: Markdown Block Support

The `submit_response` tool SHALL accept blocks of `type: "markdown"` with a required `text` field containing GitHub-flavored markdown. The preparer SHALL pass `markdown` blocks through untouched — no `convertMarkdownToSlack` and no client-side splitting. The validator SHALL enforce a cumulative cap of 12,000 characters across the `text` of all `markdown` blocks in a single delivered payload, mirroring Slack's documented limit. Slack itself handles oversize markdown blocks by splitting them server-side into multiple blocks; Clack does not pre-split.

#### Scenario: markdown block accepted and passed through

- **WHEN** Claude calls `submit_response` with a `markdown` block whose `text` is well under 12,000 cumulative chars
- **THEN** the schema parse passes
- **AND** `prepareBlocks` returns the block unchanged (no markdown conversion, no splitting)
- **AND** validation passes
- **AND** the deliver callback receives the markdown block as authored

#### Scenario: cumulative markdown text exceeds 12,000 chars

- **GIVEN** the `blocks` array contains multiple `markdown` blocks whose `text` lengths sum to more than 12,000 characters
- **WHEN** the tool validates the blocks
- **THEN** the tool returns a validation error naming the cumulative character count and the 12,000-char limit
- **AND** the error suggests reducing total markdown content or splitting across multiple responses
- **AND** the deliver callback is not called

#### Scenario: a single markdown block exceeds 12,000 chars

- **WHEN** Claude submits one `markdown` block whose `text` alone exceeds 12,000 characters
- **THEN** the tool returns a validation error citing the cumulative cap (it is the same constraint, by definition the cumulative sum)
- **AND** the deliver callback is not called

#### Scenario: markdown block missing text

- **WHEN** Claude submits a `markdown` block with no `text` field, or `text: ""`
- **THEN** the schema parse rejects the block with an error identifying the missing/empty `text` field

### Requirement: Top-Level Table Parameter

The `submit_response` tool SHALL accept an optional top-level `table` parameter, sibling to `blocks`. When present, `table` is a single Slack `table` block with a required `rows` field — an array of row arrays of cells. Each cell SHALL be either (a) a bare string, (b) `{ type: "raw_text", text }`, or (c) `{ type: "rich_text", elements: [...] }`. The schema enforces "at most one table per message" structurally (single optional field). The preparer SHALL normalize bare-string cells into `{ type: "raw_text", text }` and pass the other forms through untouched. The validator SHALL enforce: at most 100 rows; at most 20 cells per row; at most 20 entries in the optional `column_settings` array; and, for string and `raw_text` cells, at most 2,000 characters of text. The per-cell text cap is NOT enforced for `rich_text` cells because computing rendered text length would require encoding Slack's rich_text element schema. At the Slack send boundary, the prepared `table` SHALL be appended to the `blocks` array passed to `chat.postMessage`. Slack itself renders the table at the bottom of the message.

#### Scenario: top-level table accepted with bare-string cells

- **WHEN** Claude calls `submit_response` with a `table` parameter whose rows contain bare-string cells
- **THEN** the schema parse passes
- **AND** `prepareTable` wraps each bare-string cell as `{ type: "raw_text", text: <string> }`
- **AND** validation passes
- **AND** the deliver callback receives the prepared blocks plus the prepared table appended at the end

#### Scenario: top-level table cell with rich_text elements passed through

- **WHEN** Claude calls `submit_response` with a `table` parameter containing a cell of shape `{ type: "rich_text", elements: [...] }`
- **THEN** the schema parse passes
- **AND** `prepareTable` does not modify the rich_text cell
- **AND** validation passes
- **AND** the deliver callback receives the rich_text cell as authored

#### Scenario: top-level table exceeds 100 rows

- **WHEN** the `table` parameter has more than 100 rows
- **THEN** the tool returns a validation error naming the row count and the 100-row limit
- **AND** the deliver callback is not called

#### Scenario: top-level table row exceeds 20 cells

- **WHEN** any row of the `table` parameter has more than 20 cells
- **THEN** the tool returns a validation error naming the row index, cell count, and the 20-cell limit
- **AND** the deliver callback is not called

#### Scenario: top-level table column_settings exceeds 20 entries

- **WHEN** the `table` parameter has a `column_settings` array with more than 20 items
- **THEN** the tool returns a validation error naming the count and the 20-item limit

#### Scenario: string or raw_text cell exceeds 2,000 chars

- **WHEN** a string or `raw_text` cell's text in the `table` parameter exceeds 2,000 characters
- **THEN** the tool returns a validation error naming the row index, cell index, current length, and the 2,000-char limit

#### Scenario: rich_text cell skips per-cell text cap

- **WHEN** a `rich_text` cell in the `table` parameter contains element-tree text that would exceed 2,000 characters when rendered
- **THEN** the tool does NOT raise a per-cell text-cap error (we don't measure rich_text element text — rendering correctness is enforced server-side)

#### Scenario: top-level table appended to blocks at delivery

- **GIVEN** Claude calls `submit_response` with a `blocks` array of N entries and a non-null `table` parameter
- **WHEN** the deliver callback posts the message via `chat.postMessage`
- **THEN** the outgoing `blocks` argument contains the N prepared content blocks followed by the prepared table block as the (N+1)th entry
- **AND** Slack renders the table at the bottom of the resulting message

#### Scenario: post_to action accepts a sibling table

- **WHEN** Claude includes a `post_to` action with a `blocks` array and a `table` parameter
- **THEN** the schema parse and validation apply the same rules as the top-level `submit_response.table`
- **AND** the per-button snapshot persists `blocks` and `table` together
- **AND** at delivery (auto-execute or button-click path), the prepared table is appended to the cross-posted `blocks` argument

#### Scenario: post_to without table delivers blocks only

- **WHEN** a `post_to` action omits the `table` parameter
- **THEN** the cross-posted message receives the `blocks` argument unchanged (no table appended)
- **AND** the snapshot stores no `table` field

