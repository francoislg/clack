## MODIFIED Requirements

### Requirement: Read Config File Tool

The system SHALL provide a `read_config_file` MCP tool that returns both default and custom content for an instruction file, available only to admin and owner users.

#### Scenario: Read file with both default and custom content
- **WHEN** Claude calls `read_config_file` with a valid `{role}/{filename}` path
- **AND** both a default and custom version exist
- **THEN** the tool returns `default_content` with the shipped default content
- **AND** returns `custom_content` with the override content

#### Scenario: Read file with default only
- **WHEN** Claude calls `read_config_file` with a valid `{role}/{filename}` path
- **AND** a default exists but no custom override
- **THEN** the tool returns `default_content` with the shipped content
- **AND** returns `custom_content` as `null`

#### Scenario: Read custom-only file
- **WHEN** Claude calls `read_config_file` with a `{role}/{filename}` path
- **AND** only a custom file exists (no shipped default)
- **THEN** the tool returns `default_content` as `null`
- **AND** returns `custom_content` with the file content

#### Scenario: File not found
- **WHEN** Claude calls `read_config_file` with a path that does not exist in either tier
- **THEN** the tool returns an error indicating the file was not found

#### Scenario: Read resolved instructions for a role
- **GIVEN** an admin wants to see what a specific role level actually receives
- **WHEN** Claude calls `read_config_file` with a `role` parameter (e.g., `"dev"`) and no filename
- **THEN** the tool returns the full cascaded instruction set for that role's chain
- **AND** this is the same content that would be assembled by the CascadingConfigResolver

### Requirement: Config Update Detection

The system SHALL detect config update intent via the `propose_config_update` MCP tool call, accepting directory-scoped paths.

#### Scenario: Config update with role-scoped path
- **GIVEN** an admin or owner user asked Claude to update a configuration file
- **WHEN** Claude calls `propose_config_update` with `file` as `{role}/{filename}` and content
- **THEN** the tool stages the content for the specified role-scoped path
- **AND** stages a `config_update` intent with a ref ID

#### Scenario: Create new instruction file
- **GIVEN** an admin asks Claude to add new instructions (e.g., "add info about our Sentry setup")
- **WHEN** Claude determines a new file is appropriate
- **AND** calls `propose_config_update` with a new `{role}/{filename}` path
- **THEN** the tool stages the content as a new file creation
- **AND** the target directory is created if it does not exist

#### Scenario: Config update with replace operation
- **GIVEN** an admin asks Claude to rewrite the content of an existing instruction file
- **WHEN** Claude calls `propose_config_update` with `operation: "replace"` and the full new content
- **THEN** the tool stages the provided content as the complete replacement

#### Scenario: Config update with append operation
- **GIVEN** an admin asks Claude to add content to an existing instruction file
- **WHEN** Claude calls `propose_config_update` with `operation: "append"` (or omitted)
- **THEN** the tool reads the current file content (custom override, or default if no override)
- **AND** appends the provided content
- **AND** stages the combined result

#### Scenario: Validation - path must be in a role directory
- **GIVEN** Claude calls `propose_config_update` with a file path not scoped to a known role directory
- **AND** not scoped to a known repository directory
- **WHEN** the tool validates the input
- **THEN** the tool returns an error listing valid role directories

#### Scenario: Non-admin user cannot access tool
- **GIVEN** a non-admin user
- **WHEN** the tool server is built
- **THEN** `propose_config_update` is NOT registered
- **AND** Claude cannot call it regardless of prompt instructions

### Requirement: List Config Files Tool

The system SHALL provide a `list_config_files` MCP tool that returns files grouped by role directory.

#### Scenario: List files grouped by directory
- **WHEN** Claude calls `list_config_files`
- **THEN** the tool returns files organized by role directory
- **AND** each file entry includes its name and source status (`"default"`, `"customized"`, or `"custom-only"`)

#### Scenario: Include repo instruction files
- **WHEN** Claude calls `list_config_files`
- **THEN** the response also includes per-repo instruction files (`{repo}/changes_instructions.md`, `{repo}/worktree_setup_instructions.md`)
- **AND** these are grouped under the repository name

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
- **AND** validates the file path is within a known role or repository directory
- **AND** writes the content via `writeInstructionFile()`
- **AND** replies confirming the update was applied

#### Scenario: Dismiss config update
- **GIVEN** a pending config update staged via tool
- **WHEN** a user clicks the dismiss/reject button
- **THEN** the ephemeral message is deleted
- **AND** no file is written

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

## ADDED Requirements

### Requirement: Smart File Placement Instructions

The system SHALL instruct Claude to intelligently determine file placement when an admin requests instruction changes.

#### Scenario: Content fits existing file
- **GIVEN** an admin asks Claude to add a rule about response formatting
- **AND** `user/response-style.md` already covers response formatting topics
- **WHEN** Claude analyzes the request
- **THEN** Claude proposes appending to `user/response-style.md`

#### Scenario: Content is a new distinct topic
- **GIVEN** an admin asks Claude to add context about the company's Sentry setup
- **AND** no existing file covers Sentry or monitoring topics
- **WHEN** Claude analyzes the request
- **THEN** Claude proposes creating a new file with a descriptive name (e.g., `user/mcp-sentry.md`)

#### Scenario: Uncertain placement
- **GIVEN** an admin asks Claude to add instructions that could fit multiple existing files
- **WHEN** Claude cannot confidently determine the best placement
- **THEN** Claude asks the admin whether to merge into an existing file or create a new one

### Requirement: Resolved View for Admins

The system SHALL allow admins to request a resolved view of instructions as they would appear for a given role.

#### Scenario: View resolved instructions for a role
- **GIVEN** an admin asks "what does a dev see?"
- **WHEN** Claude uses the read config tool with a role parameter
- **THEN** Claude receives the full cascaded instruction set for that role
- **AND** presents it to the admin

#### Scenario: Compare default vs customized
- **GIVEN** an admin asks "what did I change from the defaults?"
- **WHEN** Claude reads files using `read_config_file`
- **THEN** Claude compares `default_content` and `custom_content` for each file
- **AND** explains the differences in natural language
