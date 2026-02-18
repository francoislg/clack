## MODIFIED Requirements

### Requirement: submit_response Tool

The system SHALL provide a `submit_response` MCP tool that defines the user-facing response with structured content and actions.

#### Scenario: Basic response with sections

- **WHEN** Claude calls `submit_response` with a sections array
- **THEN** each section contains an optional `title` (string) and a required `body` (string, markdown)
- **AND** the tool captures the payload for rendering
- **AND** returns a confirmation to Claude

#### Scenario: Response with actions

- **WHEN** Claude calls `submit_response` with an actions array
- **THEN** each action has a `type` from the known set: `accept`, `reject`, `edit`, `refine`, `followup`, `choice`, `change`, `config_update`, `review`, `merge`, `update`, `close`
- **AND** each action type has its own schema for additional fields
- **AND** ref-based actions (`change`, `update`, `review`, `merge`, `close`) support an optional `auto` boolean field

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

#### Scenario: Config update action with ref (no auto support)

- **WHEN** `submit_response` includes `{ type: "config_update", ref: "<id>" }` with optional custom `label`
- **THEN** the Slack UI renders a button (default label: "Apply Update")
- **AND** clicking writes the config file with the validated data from the staged intent
- **AND** the `auto` flag is NOT supported for this action type

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
