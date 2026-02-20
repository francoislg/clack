# clack-tool-response Specification

## Purpose
The `submit_response` MCP tool contract defining how Claude structures user-facing responses with typed sections and interactive actions, rendered as Slack Block Kit messages.

## Requirements
### Requirement: submit_response Tool

The system SHALL provide a `submit_response` MCP tool that defines the user-facing response with structured content and actions.

#### Scenario: Basic response with sections

- **WHEN** Claude calls `submit_response` with a sections array
- **THEN** each section contains an optional `title` (string) and a required `body` (string, markdown)
- **AND** the tool captures the payload for rendering
- **AND** returns a confirmation to Claude

#### Scenario: Response with actions

- **WHEN** Claude calls `submit_response` with an actions array
- **THEN** each action has a `type` from the known set: `accept`, `reject`, `edit`, `refine`, `followup`, `choice`, `change`, `config_update`, `review`, `merge`, `update`, `close`, `send_to_thread`
- **AND** each action type has its own schema for additional fields
- **AND** ref-based actions (`change`, `config_update`, `update`, `review`, `merge`, `close`) support an optional `auto` boolean field

#### Scenario: Fallback when submit_response not called

- **WHEN** the query completes without Claude calling `submit_response`
- **THEN** the system falls back to Claude's raw text output
- **AND** renders it with a generic retry/reject UI

### Requirement: Terminal Action Types

The system SHALL support terminal actions that end the conversation after user interaction.

#### Scenario: Accept action

- **WHEN** `submit_response` includes `{ type: "accept" }` with optional custom `label`
- **THEN** the Slack UI renders a button (default label: "Accept")
- **AND** clicking posts the response sections publicly in the thread

#### Scenario: Reject action

- **WHEN** `submit_response` includes `{ type: "reject" }` with optional custom `label`
- **THEN** the Slack UI renders a danger-styled button (default label: "Reject")
- **AND** clicking deletes the ephemeral message

#### Scenario: Edit action

- **WHEN** `submit_response` includes `{ type: "edit" }` with optional custom `label`
- **THEN** the Slack UI renders a button (default label: "Edit & Accept")
- **AND** clicking opens a modal pre-filled with the response text for editing before posting

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

The system SHALL support a `send_to_thread` action type for DM-first delivery mode.

#### Scenario: send_to_thread action in submit_response
- **WHEN** Claude calls `submit_response` with `{ type: "send_to_thread" }` and optional `label`
- **THEN** the Slack UI renders a primary-styled button (default label: "Send to thread")
- **AND** clicking triggers the DM-first synthesis flow (synthesize conversation, post to original channel thread)

#### Scenario: send_to_thread action rendering
- **WHEN** a response includes a `send_to_thread` action
- **THEN** the button is rendered with action_id `clack_dm_send_to_thread`
- **AND** the button value encodes the session ID

### Requirement: Continuation Action Types

The system SHALL support continuation actions that resume the conversation with new user input.

#### Scenario: Refine action

- **WHEN** `submit_response` includes `{ type: "refine" }` with optional `label` and `hint`
- **THEN** the Slack UI renders a button (default label: "Refine")
- **AND** clicking opens a modal for free-text input
- **AND** if `hint` is provided, it is used as the modal's placeholder text
- **AND** submitting re-invokes Claude with the refinement text added to session context

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
- **AND** button style reflects type: `accept`, `change`, `merge`, and `send_to_thread` are primary, `reject` and `close` are danger, others are default
- **AND** button `value` encodes the session ID and action metadata for handler resolution

#### Scenario: Button limit handling

- **WHEN** the response includes more than 5 actions
- **THEN** actions are split across multiple Slack actions blocks (max 5 buttons per block)

### Requirement: Block Validation Before Capture

The `submit_response` tool SHALL validate the rendered Slack blocks against known Block Kit constraints before capturing the payload.

#### Scenario: Section text within limits

- **WHEN** Claude calls `submit_response` with sections whose rendered mrkdwn text is within Slack's 3000-character section limit
- **THEN** the payload is captured and success is returned

#### Scenario: Section text exceeds limit

- **WHEN** Claude calls `submit_response` with a section whose rendered mrkdwn text exceeds 3000 characters (after markdown-to-mrkdwn conversion and splitting)
- **THEN** the tool returns an error identifying the oversized section (by index and title if present)
- **AND** includes the current character count and the limit
- **AND** does NOT capture the payload
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
