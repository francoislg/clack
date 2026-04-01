# admin-config-tools Specification

## Purpose
MCP tools for admins to read and write core configuration files (config.json, mcp.json, auth/.env, tool_mapping configs) with validation, and to trigger a soft app restart.

## Requirements

### Requirement: File Path Allowlist

The system SHALL restrict admin file tools to a static allowlist of paths relative to `data/`.

#### Scenario: Allowed file paths
- **WHEN** an admin tool receives a file path
- **THEN** the system accepts: `config.json`, `mcp.json`, `auth/.env`, and any path matching `configuration/tool_mapping/*.json`

#### Scenario: Reject disallowed path
- **WHEN** an admin tool receives a path not in the allowlist (e.g., `auth/slack.json`, `auth/github-app.pem`, `state/roles.json`)
- **THEN** the tool returns an error listing the allowed paths

#### Scenario: Reject path traversal
- **WHEN** an admin tool receives a path containing `..` segments
- **THEN** the tool returns an error indicating path traversal is not allowed

### Requirement: admin_read_file Tool

The system SHALL provide an `admin_read_file` tool that reads the content of an allowed configuration file.

#### Scenario: Read existing file
- **WHEN** Claude calls `admin_read_file` with a `path` parameter matching an allowed file
- **THEN** the tool returns the full file content as text

#### Scenario: Read non-existent file
- **WHEN** Claude calls `admin_read_file` with a `path` for a file that does not exist
- **THEN** the tool returns a message indicating the file does not exist yet
- **AND** includes a hint about the expected format (e.g., "Expected format: JSON" or "Expected format: KEY=VALUE lines")

#### Scenario: List tool_mapping files
- **WHEN** Claude calls `admin_read_file` with `path` set to `configuration/tool_mapping/`(directory, not a specific file)
- **THEN** the tool returns a listing of all `.json` files in that directory

### Requirement: admin_write_file Tool

The system SHALL provide an `admin_write_file` tool that writes content to an allowed configuration file with format-specific validation.

#### Scenario: Write config.json with validation
- **WHEN** Claude calls `admin_write_file` with `path` set to `config.json` and `content` with new JSON
- **THEN** the tool parses the content as JSON
- **AND** runs it through `validateConfig()` with the current Slack auth
- **AND** on success, writes the file and returns confirmation
- **AND** on validation failure, returns the error message without writing

#### Scenario: Write mcp.json with validation
- **WHEN** Claude calls `admin_write_file` with `path` set to `mcp.json` and `content` with new JSON
- **THEN** the tool parses the content as JSON
- **AND** verifies the top-level structure contains `mcpServers` as an object
- **AND** on success, writes the file and returns confirmation

#### Scenario: Write auth/.env with validation
- **WHEN** Claude calls `admin_write_file` with `path` set to `auth/.env` and `content` with dotenv content
- **THEN** the tool verifies each non-empty, non-comment line matches `KEY=VALUE` format
- **AND** on success, writes the file and returns confirmation

#### Scenario: Write tool_mapping JSON
- **WHEN** Claude calls `admin_write_file` with `path` matching `configuration/tool_mapping/*.json` and `content` with new JSON
- **THEN** the tool parses the content as JSON
- **AND** on success, writes the file and returns confirmation

#### Scenario: Validation failure prevents write
- **WHEN** the content fails validation for any target file
- **THEN** the tool returns the validation error
- **AND** the file on disk is NOT modified

#### Scenario: Create parent directories
- **WHEN** the target file's parent directory does not exist (e.g., `configuration/tool_mapping/` not yet created)
- **THEN** the tool creates the directory before writing

### Requirement: admin_restart_app Tool

The system SHALL provide an `admin_restart_app` tool that performs a soft application restart without dropping the Slack socket connection.

#### Scenario: Successful soft restart
- **WHEN** Claude calls `admin_restart_app`
- **THEN** the tool calls `restartAll()` from the lifecycle module
- **AND** returns a summary of what was reloaded (config version, repo count, MCP server count, scheduler status)

#### Scenario: Restart failure
- **WHEN** `restartAll()` throws an error (e.g., invalid config.json on disk)
- **THEN** the tool returns the error message
- **AND** the app continues running with its previous configuration (no partial state)

#### Scenario: Report new repositories
- **WHEN** a soft restart detects repositories in config that are not yet cloned
- **THEN** the restart summary includes the new repositories being cloned
- **AND** notes that cloning may take time for large repositories

### Requirement: Tool Role Gating

The system SHALL gate all admin config tools to users with the admin or owner role.

#### Scenario: Admin can use admin tools
- **WHEN** the tool server is built for a user with admin or owner role
- **THEN** `admin_read_file`, `admin_write_file`, and `admin_restart_app` are registered

#### Scenario: Non-admin cannot use admin tools
- **WHEN** the tool server is built for a user with member or dev role
- **THEN** `admin_read_file`, `admin_write_file`, and `admin_restart_app` are NOT registered
