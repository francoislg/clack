# Config Update Via Chat Specification

## Purpose
Allow admins to update configuration files through Slack chat, with Claude proposing changes via MCP tools and a confirmation flow before applying them.

## Requirements

### Requirement: Read Config File Tool

The system SHALL provide a `read_config_file` MCP tool that returns the current content of an instruction file, available only to admin and owner users.

#### Scenario: Read existing override file

- **WHEN** Claude calls `read_config_file` with a valid filename
- **AND** a custom override exists for that file
- **THEN** the tool returns the override content

#### Scenario: Read default file (no override)

- **WHEN** Claude calls `read_config_file` with a valid filename
- **AND** no custom override exists but a default file does
- **THEN** the tool returns the default content
- **AND** indicates the file is using defaults (no customization)

#### Scenario: File not found

- **WHEN** Claude calls `read_config_file` with an unknown filename
- **THEN** the tool returns an error listing available filenames

#### Scenario: File has no content

- **WHEN** Claude calls `read_config_file` with a valid filename
- **AND** neither an override nor a default exists
- **THEN** the tool returns empty content and indicates the file does not exist yet

### Requirement: Config Update Detection

The system SHALL detect config update intent via the `propose_config_update` MCP tool call.

#### Scenario: Config update via tool call with append (default)

- **GIVEN** an admin or owner user asked Claude to update a configuration file
- **WHEN** Claude calls `propose_config_update` with file and content (operation omitted or `"append"`)
- **THEN** the tool reads the current file content (override or default)
- **AND** appends the provided content to the end
- **AND** stages the combined result as a `config_update` intent with a ref ID
- **AND** Claude includes a `config_update` action referencing the ref in `submit_response`

#### Scenario: Config update via tool call with replace

- **GIVEN** an admin or owner user asked Claude to remove or rewrite content in a configuration file
- **WHEN** Claude calls `propose_config_update` with file, content, and `operation: "replace"`
- **THEN** the tool stages the provided content as the full replacement
- **AND** stages the intent with a ref ID
- **AND** Claude includes a `config_update` action referencing the ref in `submit_response`

#### Scenario: Append to file with no override

- **GIVEN** no custom override exists for the target file
- **AND** a default file exists
- **WHEN** Claude calls `propose_config_update` with `operation: "append"` (or omitted)
- **THEN** the tool reads the default content and appends the new content
- **AND** the staged intent contains the default content plus the addition

#### Scenario: Append to file with no content at all

- **GIVEN** neither an override nor a default exists for the target file
- **WHEN** Claude calls `propose_config_update` with `operation: "append"` (or omitted)
- **THEN** the staged content is just the provided content (nothing to append to)

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
