## ADDED Requirements

### Requirement: Config Update Block Variable

The system SHALL provide a `CONFIG_UPDATE_BLOCK` instruction variable for admin/owner system prompts.

#### Scenario: Variable registered in registry
- **WHEN** the instruction variables registry is loaded
- **THEN** it includes `CONFIG_UPDATE_BLOCK` with description and admin-only scope

#### Scenario: Variable populated for admin users
- **GIVEN** the user has admin or owner role
- **WHEN** the system prompt variables are built
- **THEN** `CONFIG_UPDATE_BLOCK` contains the list of config files, read paths, and output format instructions

#### Scenario: Variable empty for non-admin users
- **GIVEN** the user has dev or member role
- **WHEN** the system prompt variables are built
- **THEN** `CONFIG_UPDATE_BLOCK` is an empty string
