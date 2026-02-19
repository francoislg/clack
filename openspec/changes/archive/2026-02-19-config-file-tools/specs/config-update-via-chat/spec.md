## ADDED Requirements

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

## MODIFIED Requirements

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
