## MODIFIED Requirements

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
