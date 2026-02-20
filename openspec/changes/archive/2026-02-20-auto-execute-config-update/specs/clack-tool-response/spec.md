## MODIFIED Requirements

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

#### Scenario: Response with actions

- **WHEN** Claude calls `submit_response` with an actions array
- **THEN** each action has a `type` from the known set: `accept`, `reject`, `edit`, `refine`, `followup`, `choice`, `change`, `config_update`, `review`, `merge`, `update`, `close`, `send_to_thread`
- **AND** each action type has its own schema for additional fields
- **AND** ref-based actions (`change`, `config_update`, `update`, `review`, `merge`, `close`) support an optional `auto` boolean field
