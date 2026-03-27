## MODIFIED Requirements

### Requirement: Migration Registry

The system SHALL maintain an ordered registry of migrations in `src/migrations/`.

#### Scenario: Migration structure
- **WHEN** a migration is defined
- **THEN** it SHALL export an object with: version (integer), name (string), priority ("blocking" or "enhancement"), files (string array), and optionally prompt (string) and/or static (function)

#### Scenario: Migration must have at least one execution path
- **WHEN** a migration is defined
- **THEN** it SHALL have at least one of `prompt` or `static` defined

#### Scenario: Migrations ordered by version
- **WHEN** the migration registry is loaded
- **THEN** migrations are available in ascending version order

#### Scenario: Detect pending migrations
- **WHEN** the current version is V and migrations exist for versions V+1, V+2, ...
- **THEN** the system identifies those as pending migrations

### Requirement: Claude-Powered Migration Execution

The system SHALL use Claude to execute migrations that define a prompt.

#### Scenario: Execute migration prompt
- **WHEN** a migration with a `prompt` is executed
- **AND** no `static` function is defined (or `static` has already run)
- **THEN** the system invokes Claude with the migration's prompt
- **AND** provides system instructions explaining the migration context
- **AND** scopes file access to the migration's files array

#### Scenario: File scope enforcement
- **WHEN** Claude executes a migration
- **THEN** Claude can only read and write files listed in the migration's files array

#### Scenario: Skip Claude for static-only migrations
- **WHEN** a migration defines `static` but no `prompt`
- **AND** the static transform succeeds
- **THEN** Claude is NOT invoked

### Requirement: Create-Migration Skill

The project SHALL include a Claude Code skill for scaffolding new migrations.

#### Scenario: Scaffold new migration
- **WHEN** a developer invokes the create-migration skill
- **THEN** the skill reads existing migrations to determine the next version number
- **AND** generates a new migration file with version, name, priority, and files
- **AND** includes either a static function, a prompt, or both depending on the migration type
- **AND** registers the migration in the barrel export

#### Scenario: Infer static migration from context
- **WHEN** a developer invokes the create-migration skill for a JSON-only config change
- **THEN** the skill scaffolds a static transform function by default

## ADDED Requirements

### Requirement: Static Migration Execution

The system SHALL support executing migrations via TypeScript functions without invoking Claude.

#### Scenario: Execute static transform
- **WHEN** a migration with a `static` function is executed
- **THEN** the system reads all files listed in the migration's files array
- **AND** passes their contents (or null for missing files) to the static function
- **AND** writes the returned file contents to disk
- **AND** deletes files marked with `{ delete: true }` in the return value
- **AND** does not modify files absent from the return value

#### Scenario: Static runs before Claude in mixed migrations
- **WHEN** a migration defines both `static` and `prompt`
- **THEN** the static transform runs first
- **AND** Claude sees the already-transformed file contents

#### Scenario: Static transform error with prompt fallback
- **WHEN** a migration defines both `static` and `prompt`
- **AND** the static transform throws an error
- **THEN** the system falls back to executing the Claude prompt
- **AND** appends the static error message to the prompt context

#### Scenario: Static transform error without prompt
- **WHEN** a migration defines `static` but no `prompt`
- **AND** the static transform throws an error
- **THEN** the migration fails with the static error

#### Scenario: Static file result types
- **WHEN** a static transform returns results
- **THEN** string values are written as file content
- **AND** `{ delete: true }` values cause the file to be deleted
- **AND** files not present in the return are left untouched
