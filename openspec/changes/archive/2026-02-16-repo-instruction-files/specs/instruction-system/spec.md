## MODIFIED Requirements

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

#### Scenario: Repository-scoped instruction files
- **GIVEN** a repository named `{repo-name}` is configured in `config.repositories`
- **WHEN** the system enumerates known instruction files
- **THEN** it includes `{repo-name}_changes_instructions.md` and `{repo-name}_worktree_setup_instructions.md`
- **AND** these files follow the same two-tier resolution chain
