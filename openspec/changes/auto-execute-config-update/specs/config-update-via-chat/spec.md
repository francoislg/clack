## ADDED Requirements

### Requirement: Config Update Auto-Execute

The system SHALL support auto-execution of config updates when Claude sets `auto: true`, enabling immediate file writes for clear user directives without requiring a button click.

#### Scenario: Auto-execute config update on clear directive

- **GIVEN** an admin or owner user gives a clear directive to update configuration (e.g., "update the config to add X")
- **AND** Claude calls `propose_config_update` and receives a ref
- **WHEN** Claude calls `submit_response` with `{ type: "config_update", ref: "<id>", auto: true }`
- **THEN** the system writes the config file immediately via `writeInstructionFile()`
- **AND** posts a confirmation message in the thread
- **AND** does NOT render a button for the config_update action

#### Scenario: Proposal mode for exploratory config discussions

- **GIVEN** an admin or owner user is exploring or discussing a potential config change (e.g., "maybe we should add X")
- **AND** Claude calls `propose_config_update` and receives a ref
- **WHEN** Claude calls `submit_response` with `{ type: "config_update", ref: "<id>" }` (no `auto` or `auto: false`)
- **THEN** the system renders an "Apply Update" button
- **AND** the config file is NOT written until the user clicks the button

#### Scenario: Auto-execute config update failure

- **GIVEN** a config update action has `auto: true`
- **WHEN** `writeInstructionFile()` throws an error
- **THEN** the system posts an error message in the thread
- **AND** does NOT crash or affect the posted response
