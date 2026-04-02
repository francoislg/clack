# clack-tool-response Specification

## Purpose
The `submit_response` MCP tool contract defining how Claude structures user-facing responses with typed sections and interactive actions, rendered as Slack Block Kit messages.

## Requirements
### Requirement: submit_response Tool

The system SHALL provide a `submit_response` MCP tool that defines the user-facing response with structured content and actions, and delivers it to Slack. The tool also supports a `skip_response` mode that declines to answer.

#### Scenario: Basic response with sections

- **WHEN** Claude calls `submit_response` with a sections array
- **THEN** each section contains an optional `title` (string) and a required `body` (string, markdown)
- **AND** the tool validates the rendered blocks
- **AND** the tool delivers the response to Slack via the injected deliver callback
- **AND** captures the payload for session persistence
- **AND** returns a delivery confirmation to Claude

#### Scenario: Response with actions

- **WHEN** Claude calls `submit_response` with an actions array
- **THEN** each action has a `type` from the known set: `followup`, `choice`, `change`, `config_update`, `update`, `post_to`
- **AND** each action type has its own schema for additional fields
- **AND** ref-based actions (`change`, `config_update`, `update`) support an optional `auto` boolean field

#### Scenario: Delivery failure returned to Claude

- **WHEN** Claude calls `submit_response` with valid sections and actions
- **AND** the Slack delivery fails (msg_too_long, invalid_blocks, or other API error)
- **THEN** the tool returns an error to Claude with the Slack error details
- **AND** does NOT capture the payload
- **AND** Claude can adjust the content and call `submit_response` again

#### Scenario: Successful delivery

- **WHEN** Claude calls `submit_response` and Slack delivery succeeds
- **THEN** the tool returns `{ success: true, delivered: true }` to Claude
- **AND** captures the payload in ResponseCapture for session persistence

#### Scenario: Already delivered guard

- **WHEN** Claude calls `submit_response` after a previous successful delivery in the same session
- **THEN** the tool returns an error indicating the response was already delivered
- **AND** does NOT attempt a second delivery

#### Scenario: Fallback when submit_response not called

- **WHEN** the query completes without Claude calling `submit_response`
- **THEN** the system falls back to Claude's raw text output
- **AND** delivers it via the streamer or one-shot posting

#### Scenario: Skip response with valid acknowledgment

- **WHEN** Claude calls `submit_response` with `skip_response: true` and the correct acknowledgment message
- **THEN** the tool does NOT call the deliver callback
- **AND** does NOT render blocks or validate sections
- **AND** sets the skipped flag on ResponseCapture
- **AND** returns `{ success: true, skipped: true }` to Claude

#### Scenario: Skip response with invalid acknowledgment

- **WHEN** Claude calls `submit_response` with `skip_response: true` and an incorrect or missing message
- **THEN** the tool returns an error containing the required exact acknowledgment string
- **AND** does NOT set the skipped flag

#### Scenario: Sections not required when skipping

- **WHEN** Claude calls `submit_response` with `skip_response: true`
- **THEN** the `sections` and `actions` parameters are not required
- **AND** only `skip_response` and `message` are validated

#### Scenario: Change action with ref and optional auto

- **WHEN** `submit_response` includes `{ type: "change", ref: "<id>" }` with optional `label` and optional `auto`
- **THEN** if `auto` is `true`, the system auto-executes the change workflow after posting the response
- **AND** if `auto` is not `true`, the Slack UI renders a primary-styled button (default label: "Start Change") that triggers on click

#### Scenario: Config update action with ref and optional auto

- **WHEN** `submit_response` includes `{ type: "config_update", ref: "<id>" }` with optional custom `label` and optional `auto`
- **THEN** if `auto` is `true`, the system auto-executes the config update after posting the response
- **AND** if `auto` is not `true`, the Slack UI renders a button (default label: "Apply Update")
- **AND** clicking writes the config file with the validated data from the staged intent

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
