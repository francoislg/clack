## MODIFIED Requirements

### Requirement: Variable Interpolation

The system SHALL interpolate variables in all instruction files.

#### Scenario: Standard variables
- **WHEN** instruction files are loaded
- **THEN** the system replaces `{REPOSITORIES_LIST}` with the formatted repository list
- **AND** replaces `{BOT_NAME}` with the configured app name
- **AND** replaces `{MCP_INTEGRATIONS}` with the formatted MCP server list

#### Scenario: Change-specific variables
- **GIVEN** changesWorkflow is enabled and the user has change capabilities
- **WHEN** the dev/admin instructions file is loaded
- **THEN** the system replaces `{CHANGE_REQUEST_BLOCK}` with the full change detection section
- **AND** replaces `{RESUMABLE_SESSIONS}` with the user's active resumable sessions

#### Scenario: Admin meta-variable
- **GIVEN** the admin instructions file contains `{AVAILABLE_VARIABLES}`
- **WHEN** interpolation runs
- **THEN** the system replaces `{AVAILABLE_VARIABLES}` with an auto-generated variable reference table sourced from the instruction variables registry

#### Scenario: Unavailable variables resolve to empty
- **GIVEN** a variable is referenced in an instruction file but has no value in context
- **WHEN** interpolation runs
- **THEN** the variable placeholder is replaced with an empty string
