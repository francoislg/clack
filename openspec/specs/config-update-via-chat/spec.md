# Config Update Via Chat Specification

## Purpose
Allow admins to update configuration files through Slack chat, with Claude proposing changes via MCP tools and a confirmation flow before applying them.

## Requirements
### Requirement: Config Update Detection

The system SHALL detect config update intent via the `propose_config_update` MCP tool call.

#### Scenario: Config update via tool call
- **GIVEN** an admin or owner user asked Claude to update a configuration file
- **WHEN** Claude calls `propose_config_update` with file and content
- **THEN** the tool validates the filename and content
- **AND** stages the intent with a ref ID
- **AND** Claude includes a `config_update` action referencing the ref in `submit_response`

#### Scenario: Validation error handled by Claude
- **GIVEN** Claude calls `propose_config_update` with an invalid filename
- **WHEN** the tool returns an error
- **THEN** Claude receives the error message
- **AND** Claude can retry with a corrected filename or explain the issue to the user

#### Scenario: Non-admin user cannot access tool
- **GIVEN** a non-admin user
- **WHEN** the tool server is built
- **THEN** `propose_config_update` is NOT registered
- **AND** Claude cannot call it regardless of prompt instructions

### Requirement: Config Update Confirmation Flow

The system SHALL show a preview and require explicit confirmation before writing config files.

#### Scenario: Show preview with action buttons
- **GIVEN** Claude called `propose_config_update` and included a `config_update` action in `submit_response`
- **WHEN** the response is rendered
- **THEN** the sections from `submit_response` show the preview (Claude controls the diff/preview content)
- **AND** the `config_update` action renders as an "Apply Update" button
- **AND** a `reject` action renders as a dismiss button

#### Scenario: Apply config update
- **GIVEN** a pending config update staged via tool
- **WHEN** an admin clicks the "Apply Update" button
- **THEN** the system resolves the staged intent by ref ID
- **AND** verifies the user is an admin
- **AND** validates the filename is in the known instruction files list
- **AND** writes the content via `writeInstructionFile()`
- **AND** replies confirming the update was applied

#### Scenario: Dismiss config update
- **GIVEN** a pending config update staged via tool
- **WHEN** a user clicks the dismiss/reject button
- **THEN** the ephemeral message is deleted
- **AND** no file is written

#### Scenario: Invalid filename rejected at tool level
- **GIVEN** Claude calls `propose_config_update` with a filename not in `listInstructionFiles()`
- **WHEN** the tool validates the input
- **THEN** the tool returns an error to Claude
- **AND** Claude can retry or inform the user
