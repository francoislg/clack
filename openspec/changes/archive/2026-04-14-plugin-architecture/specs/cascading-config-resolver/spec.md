## MODIFIED Requirements

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
