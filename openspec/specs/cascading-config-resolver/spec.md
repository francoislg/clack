# cascading-config-resolver Specification

## Purpose
Role-based directory structure with cascading resolution for composing system prompts. Files are organized into role directories, resolved through a two-tier chain (default vs custom) within each role level, then cascaded across role levels based on the user's role chain.
## Requirements
### Requirement: Role Directory Structure

The system SHALL organize instruction files into role-based directories instead of flat files.

#### Scenario: Role directories in default configuration
- **WHEN** the project is checked out
- **THEN** `data/default_configuration/` contains directories `user/`, `dev/`, and `admin/`
- **AND** each directory contains one or more `.md` instruction files
- **AND** old flat files (`instructions.md`, `user_instructions.md`, `dev_instructions.md`, `admin_instructions.md`) do NOT exist

#### Scenario: Role directories in user configuration
- **WHEN** an admin creates or modifies instruction files
- **THEN** the files are written to `data/configuration/{role}/{filename}.md`
- **AND** the `{role}` directory is created automatically if it does not exist

#### Scenario: Unrecognized role directory ignored
- **GIVEN** a directory exists in `data/configuration/` that does not match a known role name
- **AND** is not a repository name
- **WHEN** the resolver scans for instruction files
- **THEN** the directory is ignored

### Requirement: Cascading Resolution

The system SHALL resolve instruction files by cascading through an ordered list of role levels, with later roles overriding earlier ones. Plugin virtual defaults participate as an additional source between disk defaults and disk overrides.

#### Scenario: File exists only at lowest role level
- **GIVEN** `user/identity.md` exists but no `dev/identity.md` or `admin/identity.md` exists
- **WHEN** resolving instructions for a dev user with role chain `["user", "dev"]`
- **THEN** the content of `user/identity.md` is included in the result

#### Scenario: Higher role overrides lower role
- **GIVEN** `user/changes.md` exists with content "Never suggest code changes"
- **AND** `dev/changes.md` exists with content "You can propose changes"
- **WHEN** resolving instructions for a dev user with role chain `["user", "dev"]`
- **THEN** the content of `dev/changes.md` is used for `changes.md`
- **AND** the content of `user/changes.md` is NOT included

#### Scenario: File exists only at higher role level
- **GIVEN** `admin/config-updates.md` exists but no `user/config-updates.md` or `dev/config-updates.md` exists
- **WHEN** resolving instructions for an admin user with role chain `["user", "dev", "admin"]`
- **THEN** the content of `admin/config-updates.md` is included in the result

#### Scenario: File not included when role chain stops before it
- **GIVEN** `admin/config-updates.md` exists
- **WHEN** resolving instructions for a dev user with role chain `["user", "dev"]`
- **THEN** `admin/config-updates.md` is NOT included in the result

#### Scenario: Empty file suppresses instruction
- **GIVEN** `user/some-rule.md` exists with content
- **AND** `dev/some-rule.md` exists but is empty (or whitespace-only)
- **WHEN** resolving instructions for a dev user with role chain `["user", "dev"]`
- **THEN** `some-rule.md` is NOT included in the final result

#### Scenario: Plugin virtual default included in resolution
- **GIVEN** a plugin provides a virtual default file `user/trivia__instructions.md` with content "Trivia instructions"
- **AND** no disk default or custom override exists for that filename
- **WHEN** resolving instructions for a user with role chain `["user"]`
- **THEN** the content "Trivia instructions" is included in the result

#### Scenario: Custom override wins over plugin virtual default
- **GIVEN** a plugin provides a virtual default `user/trivia__instructions.md` with content "Plugin default"
- **AND** `configuration/user/trivia__instructions.md` exists on disk with content "Admin override"
- **WHEN** resolving instructions for a user with role chain `["user"]`
- **THEN** the content "Admin override" is used
- **AND** the plugin default content is NOT included

#### Scenario: Full resolution order with plugin virtual defaults
- **WHEN** resolving a file `{name}.md` for role chain `["user", "dev"]` with plugin virtual defaults
- **THEN** the system checks in this order, using the last existing source:
  1. `default_configuration/user/{name}.md` (disk default)
  2. Plugin virtual default for `user/{name}.md` (in-memory)
  3. `configuration/user/{name}.md` (disk custom)
  4. `default_configuration/dev/{name}.md` (disk default)
  5. Plugin virtual default for `dev/{name}.md` (in-memory)
  6. `configuration/dev/{name}.md` (disk custom)

#### Scenario: Plugin files discovered alongside disk files
- **GIVEN** a plugin provides virtual defaults for `user/trivia__instructions.md`
- **WHEN** the resolver discovers all unique filenames
- **THEN** `trivia__instructions.md` is included in the set of discovered filenames
- **AND** it participates in the same alphabetical concatenation as disk-discovered files

#### Scenario: Multiple plugins register same virtual filename
- **GIVEN** plugin A registers `user/shared__rules.md` with content "Rules A"
- **AND** plugin B registers `user/shared__rules.md` with content "Rules B"
- **WHEN** resolving instructions
- **THEN** the system logs a warning about the duplicate virtual filename
- **AND** the last-registered plugin's content wins

### Requirement: Two-Tier Resolution Within Each Role Level

The system SHALL resolve each role-level file through the two-tier chain (custom overrides default) before applying the cascade.

#### Scenario: Custom overrides default at same role level
- **GIVEN** `default_configuration/user/response-style.md` exists with default content
- **AND** `configuration/user/response-style.md` exists with custom content
- **WHEN** resolving `response-style.md` for the `user` role level
- **THEN** the custom content is used

#### Scenario: Interleaved resolution order
- **GIVEN** `configuration/user/changes.md` exists with custom user-level content
- **AND** `default_configuration/dev/changes.md` exists with default dev-level content
- **WHEN** resolving `changes.md` for a dev user with role chain `["user", "dev"]`
- **THEN** `default_configuration/dev/changes.md` wins (role cascade beats tier within lower role)

#### Scenario: Full resolution order
- **WHEN** resolving a file `{name}.md` for role chain `["user", "dev"]`
- **THEN** the system checks in this order, using the last existing file:
  1. `default_configuration/user/{name}.md`
  2. `configuration/user/{name}.md`
  3. `default_configuration/dev/{name}.md`
  4. `configuration/dev/{name}.md`

### Requirement: Dynamic File Discovery

The system SHALL discover instruction files by scanning role directories at resolution time, including plugin-provided virtual files.

#### Scenario: Scan default and custom directories
- **WHEN** resolving instructions for role chain `["user", "dev"]`
- **THEN** the system scans `default_configuration/user/`, `configuration/user/`, `default_configuration/dev/`, `configuration/dev/`
- **AND** collects all unique `.md` filenames across all scanned directories
- **AND** includes filenames from plugin virtual defaults

#### Scenario: Custom file with no default counterpart
- **GIVEN** `configuration/user/company-context.md` exists
- **AND** no `default_configuration/user/company-context.md` exists
- **WHEN** resolving instructions
- **THEN** `company-context.md` is included as a purely additive instruction

#### Scenario: Non-markdown files ignored
- **GIVEN** a non-`.md` file exists in a role directory (e.g., `.DS_Store`, `notes.txt`)
- **WHEN** scanning for instruction files
- **THEN** the non-`.md` file is ignored

### Requirement: File Concatenation Order

The system SHALL concatenate resolved instruction files in a deterministic order.

#### Scenario: Alphabetical ordering
- **GIVEN** resolved files include `identity.md`, `changes.md`, `submit-response.md`
- **WHEN** building the final instruction string
- **THEN** the files are concatenated in alphabetical order by filename
- **AND** separated by double newlines

### Requirement: Role Chain Builder

The system SHALL construct the role chain based on user role and changesWorkflow state.

#### Scenario: Member user
- **GIVEN** a user with role `member`
- **WHEN** building the role chain
- **THEN** the chain is `["user"]` regardless of changesWorkflow setting

#### Scenario: Dev user with changesWorkflow enabled
- **GIVEN** a user with role `dev`
- **AND** changesWorkflow is enabled for the trigger
- **WHEN** building the role chain
- **THEN** the chain is `["user", "dev"]`

#### Scenario: Dev user without changesWorkflow
- **GIVEN** a user with role `dev`
- **AND** changesWorkflow is NOT enabled for the trigger
- **WHEN** building the role chain
- **THEN** the chain is `["user"]`

#### Scenario: Admin user with changesWorkflow enabled
- **GIVEN** a user with role `admin`
- **AND** changesWorkflow is enabled for the trigger
- **WHEN** building the role chain
- **THEN** the chain is `["user", "dev", "admin"]`

#### Scenario: Admin user without changesWorkflow
- **GIVEN** a user with role `admin`
- **AND** changesWorkflow is NOT enabled for the trigger
- **WHEN** building the role chain
- **THEN** the chain is `["user", "admin"]`

#### Scenario: Owner user with changesWorkflow enabled
- **GIVEN** a user with role `owner`
- **AND** changesWorkflow is enabled for the trigger
- **WHEN** building the role chain
- **THEN** the chain is `["user", "dev", "admin", "owner"]`

#### Scenario: Owner user without changesWorkflow
- **GIVEN** a user with role `owner`
- **AND** changesWorkflow is NOT enabled for the trigger
- **WHEN** building the role chain
- **THEN** the chain is `["user", "admin", "owner"]`

### Requirement: Variable Interpolation

The system SHALL interpolate variables after concatenation of all resolved files.

#### Scenario: Variables interpolated post-concatenation
- **GIVEN** multiple resolved files contain `{BOT_NAME}` placeholders
- **WHEN** the final instruction string is assembled
- **THEN** all `{BOT_NAME}` placeholders are replaced with the configured app name
- **AND** interpolation happens once on the concatenated result, not per-file

