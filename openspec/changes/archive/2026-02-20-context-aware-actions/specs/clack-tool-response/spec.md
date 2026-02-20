## ADDED Requirements

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
- **THEN** each action has a `type` from the known set: `accept`, `reject`, `edit`, `refine`, `followup`, `choice`, `change`, `config_update`, `review`, `merge`, `update`, `close`, `send_to_thread`
- **AND** each action type has its own schema for additional fields
- **AND** ref-based actions (`change`, `update`, `review`, `merge`, `close`) support an optional `auto` boolean field

#### Scenario: Fallback when submit_response not called

- **WHEN** the query completes without Claude calling `submit_response`
- **THEN** the system falls back to Claude's raw text output
- **AND** renders it with a generic retry/reject UI
