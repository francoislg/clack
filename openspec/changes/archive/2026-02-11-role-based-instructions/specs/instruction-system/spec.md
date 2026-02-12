## ADDED Requirements

### Requirement: Instruction File Convention

The system SHALL use convention-based filenames for instruction files.

#### Scenario: Base instructions file
- **WHEN** building the system prompt
- **THEN** the system loads `instructions.md` as the base prompt
- **AND** it is always included regardless of user role

#### Scenario: Dev instructions file
- **GIVEN** the user is a dev AND changesWorkflow is enabled for the trigger
- **WHEN** building the system prompt
- **THEN** the system loads `dev_instructions.md` as the role overlay
- **AND** appends it after the base instructions

#### Scenario: Admin instructions file
- **GIVEN** the user is an admin or owner AND changesWorkflow is enabled for the trigger
- **WHEN** building the system prompt
- **THEN** the system loads `admin_instructions.md` as the role overlay
- **AND** falls back to `dev_instructions.md` if `admin_instructions.md` is not found

#### Scenario: User instructions file
- **GIVEN** the user is a member without dev/admin/owner role OR changesWorkflow is not enabled
- **WHEN** building the system prompt
- **THEN** the system loads `user_instructions.md` as the role overlay

#### Scenario: Missing role file
- **GIVEN** a role overlay file is not found in either resolution tier
- **WHEN** building the system prompt
- **THEN** the system uses only the base instructions without a role overlay

### Requirement: Two-Tier Resolution Chain

The system SHALL resolve instruction files through a two-tier lookup.

#### Scenario: Override exists in configuration
- **GIVEN** a file exists at `data/configuration/{filename}`
- **WHEN** the system resolves that instruction file
- **THEN** it uses the file from `data/configuration/`
- **AND** does not read the default

#### Scenario: No override, use default
- **GIVEN** a file does not exist at `data/configuration/{filename}`
- **AND** a file exists at `data/default_configuration/{filename}`
- **WHEN** the system resolves that instruction file
- **THEN** it uses the file from `data/default_configuration/`

#### Scenario: File not found in either tier
- **GIVEN** a file exists in neither `data/configuration/` nor `data/default_configuration/`
- **WHEN** the system resolves that instruction file
- **THEN** the base instructions file (`instructions.md`) causes a startup error
- **AND** role overlay files are silently skipped

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
- **THEN** the system replaces `{CHANGE_REPOS_LIST}` with repositories that have `supportsChanges: true`
- **AND** replaces `{RESUMABLE_SESSIONS}` with the user's active resumable sessions

#### Scenario: Unavailable variables resolve to empty
- **GIVEN** a variable is referenced in an instruction file but has no value in context
- **WHEN** interpolation runs
- **THEN** the variable placeholder is replaced with an empty string

### Requirement: Default Configuration Directory

The system SHALL ship default instruction files in `data/default_configuration/`.

#### Scenario: Default files included in repository
- **WHEN** the project is checked out
- **THEN** `data/default_configuration/instructions.md` exists with the base prompt
- **AND** `data/default_configuration/dev_instructions.md` exists with change detection instructions
- **AND** `data/default_configuration/user_instructions.md` exists with information-only instructions

#### Scenario: Default files copied to Docker image
- **WHEN** the Docker image is built
- **THEN** the `data/default_configuration/` directory is included in the image

### Requirement: Prompt Composition

The system SHALL compose the final system prompt by concatenating base and role files.

#### Scenario: Compose base plus role
- **WHEN** building the system prompt
- **THEN** the system concatenates: base instructions + role instructions
- **AND** interpolates variables after concatenation
- **AND** the role section is separated by a newline from the base
