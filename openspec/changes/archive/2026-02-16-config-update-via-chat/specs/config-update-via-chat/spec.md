## ADDED Requirements

### Requirement: Config Update Detection

The system SHALL detect when Claude's response contains a `<config-update>` tag and route it to the config update handler.

#### Scenario: Parse config update from response
- **GIVEN** an admin or owner user asked Claude to update a configuration file
- **WHEN** Claude's response contains `<config-update><file>{filename}</file><content>{content}</content></config-update>`
- **THEN** the system parses the filename and content
- **AND** returns a `ClaudeResponse` with `isConfigUpdate: true` and the parsed info

#### Scenario: Config update takes lower priority than change request
- **GIVEN** Claude's response contains both `<config-update>` and `<change-request>` tags
- **WHEN** the response is parsed
- **THEN** the change request is handled and the config update is ignored

#### Scenario: Non-admin user response with config update tags
- **GIVEN** a non-admin user's response contains `<config-update>` tags
- **WHEN** the response is parsed
- **THEN** the config update is ignored (changes workflow detection is admin-gated)

### Requirement: Config Update Confirmation Flow

The system SHALL show a preview and require explicit confirmation before writing config files.

#### Scenario: Show preview with action buttons
- **GIVEN** a config update was parsed from Claude's response
- **WHEN** the handler processes the response
- **THEN** it posts a message in the thread showing the filename and content preview
- **AND** includes "Apply" and "Dismiss" buttons
- **AND** stores the pending update content in an in-memory store keyed by a UUID

#### Scenario: Apply config update
- **GIVEN** a pending config update exists
- **WHEN** an admin clicks the "Apply" button
- **THEN** the system verifies the user is an admin
- **AND** validates the filename is in the known instruction files list
- **AND** writes the content via `writeInstructionFile()`
- **AND** replies confirming the update was applied

#### Scenario: Dismiss config update
- **GIVEN** a pending config update exists
- **WHEN** a user clicks the "Dismiss" button
- **THEN** the pending update is removed from the store
- **AND** the preview message is updated to show it was dismissed

#### Scenario: Pending update expiry
- **GIVEN** a pending config update was stored
- **WHEN** 5 minutes have elapsed without action
- **THEN** the pending update is removed from the store

#### Scenario: Invalid filename rejected
- **GIVEN** a config update was parsed with a filename not in `listInstructionFiles()`
- **WHEN** the handler validates the update
- **THEN** the update is rejected with an error message in the thread

### Requirement: Config Update System Prompt

The system SHALL include config update instructions in the system prompt for admin/owner users.

#### Scenario: Admin sees config update instructions
- **GIVEN** the user has admin or owner role
- **WHEN** the system prompt is built
- **THEN** it includes a `{CONFIG_UPDATE_BLOCK}` section listing available config files, their read paths, and the output format

#### Scenario: Non-admin does not see config update instructions
- **GIVEN** the user has dev or member role
- **WHEN** the system prompt is built
- **THEN** the `{CONFIG_UPDATE_BLOCK}` is empty

#### Scenario: File paths for reading
- **GIVEN** the config update block is included
- **WHEN** Claude needs to read current file content
- **THEN** the instructions direct Claude to read from `../configuration/{filename}` (override) or `../default_configuration/{filename}` (default) relative to the working directory
