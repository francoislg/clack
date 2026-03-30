# instruction-system Specification

## Purpose
Role-based directory instruction files with two-tier resolution chain for composing system prompts. Files are organized into role directories and resolved through the cascading-config-resolver.

## Requirements

### Requirement: Instruction File Convention

The system SHALL use role-based directories with topic-specific files for instruction files.

#### Scenario: Role directories replace flat files
- **WHEN** building the system prompt
- **THEN** the system scans role directories (`user/`, `dev/`, `admin/`, `owner/`) instead of loading flat files
- **AND** flat files (`instructions.md`, `user_instructions.md`, `dev_instructions.md`, `admin_instructions.md`) are NOT used

#### Scenario: Dev instructions via cascading
- **GIVEN** the user is a dev AND changesWorkflow is enabled for the trigger
- **WHEN** building the system prompt
- **THEN** the system resolves instructions with role chain `["user", "dev"]`
- **AND** `dev/*.md` files override matching `user/*.md` files

#### Scenario: Admin instructions via cascading
- **GIVEN** the user is an admin or owner AND changesWorkflow is enabled for the trigger
- **WHEN** building the system prompt
- **THEN** the system resolves instructions with role chain `["user", "dev", "admin"]` (or including `"owner"` for owner)
- **AND** higher role files override matching lower role files

#### Scenario: Admin without changesWorkflow
- **GIVEN** the user is an admin or owner AND changesWorkflow is NOT enabled
- **WHEN** building the system prompt
- **THEN** the system resolves instructions with role chain `["user", "admin"]`
- **AND** the dev layer is skipped entirely

#### Scenario: User/member instructions
- **GIVEN** the user is a member OR changesWorkflow is not enabled for a dev user
- **WHEN** building the system prompt
- **THEN** the system resolves instructions with role chain `["user"]` only

#### Scenario: Repository-scoped instruction files
- **GIVEN** a repository named `{repo-name}` is configured in `config.repositories`
- **WHEN** the system enumerates known instruction files
- **THEN** it includes `{repo-name}/changes_instructions.md` and `{repo-name}/worktree_setup_instructions.md`
- **AND** these files follow the same two-tier resolution chain
- **AND** they are NOT part of the role cascading system

### Requirement: Two-Tier Resolution Chain

The system SHALL resolve instruction files through a two-tier lookup within each role directory.

#### Scenario: Override exists in configuration
- **GIVEN** a file exists at `data/configuration/{role}/{filename}`
- **WHEN** the system resolves that instruction file for that role level
- **THEN** it uses the file from `data/configuration/{role}/`

#### Scenario: No override, use default
- **GIVEN** a file does not exist at `data/configuration/{role}/{filename}`
- **AND** a file exists at `data/default_configuration/{role}/{filename}`
- **WHEN** the system resolves that instruction file for that role level
- **THEN** it uses the file from `data/default_configuration/{role}/`

#### Scenario: Startup validation
- **WHEN** the system starts up
- **THEN** it validates that at least one instruction file exists in the `user/` directory (in either tier)
- **AND** fails fast with a descriptive error if no `user/` files are found

### Requirement: Prompt Composition

The system SHALL compose the final system prompt by resolving all files through the cascade and concatenating.

#### Scenario: Compose from cascaded files
- **WHEN** building the system prompt
- **THEN** the system resolves each unique filename through the role cascade
- **AND** concatenates all non-empty resolved files in alphabetical order by filename
- **AND** interpolates variables after concatenation

#### Scenario: Instruction files contain behavioral guidance only
- **WHEN** instruction files are authored or customized
- **THEN** they contain tone, style, and behavioral rules
- **AND** they do NOT contain XML format documentation or state dump placeholders
- **AND** dynamic state (repositories, sessions, config files) is available to Claude via query tools instead

### Requirement: Default Configuration Directory

The system SHALL ship default instruction files in role directories under `data/default_configuration/`.

#### Scenario: Default files included in repository
- **WHEN** the project is checked out
- **THEN** `data/default_configuration/user/` exists with topic files (identity, response style, submit response, URLs, changes)
- **AND** `data/default_configuration/dev/` exists with topic files (GitHub, changes)
- **AND** `data/default_configuration/admin/` exists with topic files (config updates)

#### Scenario: Default files copied to Docker image
- **WHEN** the Docker image is built
- **THEN** the `data/default_configuration/` directory including all role subdirectories is included in the image
