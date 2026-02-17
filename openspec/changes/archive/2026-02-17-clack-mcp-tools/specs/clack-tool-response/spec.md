## ADDED Requirements

### Requirement: submit_response Tool

The system SHALL provide a `submit_response` MCP tool that defines the user-facing response with structured content and actions.

#### Scenario: Basic response with sections

- **WHEN** Claude calls `submit_response` with a sections array
- **THEN** each section contains an optional `title` (string) and a required `body` (string, markdown)
- **AND** the tool captures the payload for rendering
- **AND** returns a confirmation to Claude

#### Scenario: Response with actions

- **WHEN** Claude calls `submit_response` with an actions array
- **THEN** each action has a `type` from the known set: `accept`, `reject`, `edit`, `refine`, `followup`, `choice`, `change`, `config_update`
- **AND** each action type has its own schema for additional fields

#### Scenario: Fallback when submit_response not called

- **WHEN** the query completes without Claude calling `submit_response`
- **THEN** the system falls back to Claude's raw text output
- **AND** renders it with a generic retry/reject UI

### Requirement: Terminal Action Types

The system SHALL support terminal actions that end the conversation after user interaction.

#### Scenario: Accept action

- **WHEN** `submit_response` includes `{ type: "accept" }` with optional custom `label`
- **THEN** the Slack UI renders a button (default label: "Share with team")
- **AND** clicking posts the response sections publicly in the thread

#### Scenario: Reject action

- **WHEN** `submit_response` includes `{ type: "reject" }` with optional custom `label`
- **THEN** the Slack UI renders a danger-styled button (default label: "Reject")
- **AND** clicking deletes the ephemeral message

#### Scenario: Edit action

- **WHEN** `submit_response` includes `{ type: "edit" }` with optional custom `label`
- **THEN** the Slack UI renders a button (default label: "Edit & Share")
- **AND** clicking opens a modal pre-filled with the response text for editing before posting

#### Scenario: Change action with ref

- **WHEN** `submit_response` includes `{ type: "change", ref: "<id>" }` with optional custom `label`
- **THEN** the Slack UI renders a button (default label: "Start change")
- **AND** clicking triggers the change workflow with the validated data from the staged intent

#### Scenario: Config update action with ref

- **WHEN** `submit_response` includes `{ type: "config_update", ref: "<id>" }` with optional custom `label`
- **THEN** the Slack UI renders a button (default label: "Apply changes")
- **AND** clicking writes the config file with the validated data from the staged intent

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
- **AND** button style reflects type: `accept` is primary, `reject` is danger, others are default
- **AND** button `value` encodes the session ID and action metadata for handler resolution

#### Scenario: Choice descriptions rendered

- **WHEN** a choice action includes a `description`
- **THEN** the description is shown as secondary text below or beside the button label

### Requirement: Change Thread Follow-Up Action Types

The system SHALL support follow-up actions in change thread contexts.

#### Scenario: Review action with ref

- **WHEN** `submit_response` includes `{ type: "review", ref: "<id>" }`
- **THEN** the Slack UI renders a button for initiating PR review
- **AND** clicking triggers the review workflow

#### Scenario: Merge action with ref

- **WHEN** `submit_response` includes `{ type: "merge", ref: "<id>" }`
- **THEN** the Slack UI renders a button for merging the PR
- **AND** clicking triggers the merge workflow

#### Scenario: Update action with ref

- **WHEN** `submit_response` includes `{ type: "update", ref: "<id>" }`
- **THEN** the Slack UI renders a button for applying additional changes
- **AND** clicking triggers the update workflow with the staged instructions

#### Scenario: Close action with ref

- **WHEN** `submit_response` includes `{ type: "close", ref: "<id>" }`
- **THEN** the Slack UI renders a button for closing the PR
- **AND** clicking triggers the close workflow
