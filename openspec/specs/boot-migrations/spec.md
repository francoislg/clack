# boot-migrations Specification

## Purpose
Provides a versioned migration system that runs Claude-powered migrations at boot time, enabling automated data and config transformations as Clack evolves.

## Requirements
### Requirement: Version Tracking

The system SHALL track a current version as an integer in `data/state/version.json`.

#### Scenario: Fresh install defaults to version 0
- **WHEN** Clack boots and `data/state/version.json` does not exist
- **THEN** the system treats the current version as 0

#### Scenario: Read existing version
- **WHEN** Clack boots and `data/state/version.json` exists with `{ "version": 3 }`
- **THEN** the system reads the current version as 3

#### Scenario: Advance version after successful migration
- **WHEN** a migration at version N completes successfully
- **THEN** the system writes `{ "version": N }` to `data/state/version.json` immediately
- **AND** does not wait for other migrations to complete

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

### Requirement: Blocking Migration Execution

The system SHALL execute blocking migrations before Clack becomes available.

#### Scenario: Run blocking migrations at boot
- **WHEN** pending migrations include blocking migrations
- **THEN** all pending blocking migrations run in version order after config load but before the Slack app starts

#### Scenario: Boot halts on blocking migration failure
- **WHEN** a blocking migration fails
- **THEN** Clack logs the error and exits with a non-zero status code
- **AND** does not start the Slack app

#### Scenario: Blocking migrations preserve order across priorities
- **WHEN** migration 4 is blocking and migration 5 is enhancement
- **THEN** migration 4 runs at boot before migration 5 is deferred to post-boot

### Requirement: Enhancement Migration Execution

The system SHALL execute enhancement migrations asynchronously after boot.

#### Scenario: Defer enhancement migrations
- **WHEN** pending migrations include enhancement migrations
- **AND** all prior blocking migrations have succeeded
- **THEN** enhancement migrations run asynchronously after the Slack app is started

#### Scenario: Clack operates during enhancement migrations
- **WHEN** enhancement migrations are running
- **THEN** Clack continues to handle Slack events normally

#### Scenario: Hot config reload after enhancement migration
- **WHEN** an enhancement migration modifies config files
- **AND** the migration completes successfully
- **THEN** the system reloads the config from disk

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

### Requirement: Admin Interaction During Migration

The system SHALL contact the admin when a migration needs human input.

#### Scenario: DM admin for input
- **WHEN** Claude indicates it needs human input during a migration
- **THEN** the system sends a DM to the owner (or first admin if no owner)
- **AND** waits for a response with a configurable timeout

#### Scenario: DM unavailable fallback
- **WHEN** the admin DM fails (no DM channel open, timeout exceeded)
- **THEN** the migration is marked as failed
- **AND** the error is surfaced on the home tab

### Requirement: Migration Resumption After Crash

The system SHALL resume from the last successful migration on restart.

#### Scenario: Resume after crash mid-sequence
- **WHEN** Clack crashed after completing migration 4 but before completing migration 5
- **AND** Clack reboots
- **THEN** the system reads version 4 from state file
- **AND** resumes from migration 5

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

### Requirement: Boot Migration Rewrites Legacy Cron Config Fields

The system SHALL include a one-shot blocking boot migration that rewrites legacy cron-related top-level fields in `data/config.json` into the new `cron` namespace. Specifically:

- A top-level `allowScheduledMessages: boolean` field SHALL be moved to `cron.userSchedules: boolean`. The legacy field SHALL be removed after the rewrite.
- A top-level `scheduledMessagesMaxRunHistory: number` field SHALL be moved to `cron.maxRunHistory: number`. The legacy field SHALL be removed after the rewrite.

If the new `cron` namespace already contains a value for a target field, the migration SHALL prefer the new value and SHALL only delete the legacy field (no overwrite). If neither the legacy field nor the new field is present, the migration SHALL leave the config file unchanged for that key (no defaults are written; the absence drives the default-value handling at runtime).

The migration SHALL be guarded by the existing `data/state/migration-version.json` mechanism and run exactly once per deployment. The migration SHALL log a single info-level message naming both old and new keys.

#### Scenario: Legacy allowScheduledMessages: true is migrated

- **GIVEN** `data/config.json` contains top-level `"allowScheduledMessages": true` and no `cron` block
- **WHEN** the boot migration runs
- **THEN** `data/config.json` is rewritten with `cron: { userSchedules: true }`
- **AND** the top-level `allowScheduledMessages` field is removed
- **AND** the migration version is incremented

#### Scenario: Legacy allowScheduledMessages: false is migrated

- **GIVEN** `data/config.json` contains top-level `"allowScheduledMessages": false` and no `cron` block
- **WHEN** the boot migration runs
- **THEN** `data/config.json` is rewritten with `cron: { userSchedules: false }`
- **AND** the top-level `allowScheduledMessages` field is removed

#### Scenario: Legacy scheduledMessagesMaxRunHistory is migrated

- **GIVEN** `data/config.json` contains top-level `"scheduledMessagesMaxRunHistory": 50`
- **WHEN** the boot migration runs
- **THEN** the resulting `cron` block contains `maxRunHistory: 50`
- **AND** the top-level `scheduledMessagesMaxRunHistory` field is removed

#### Scenario: Both legacy fields migrated together

- **GIVEN** `data/config.json` contains both `"allowScheduledMessages": true` and `"scheduledMessagesMaxRunHistory": 100`
- **WHEN** the boot migration runs
- **THEN** the resulting `cron` block contains both `userSchedules: true` AND `maxRunHistory: 100`
- **AND** both top-level legacy fields are removed

#### Scenario: New value present wins over legacy value

- **GIVEN** `data/config.json` contains both `"allowScheduledMessages": false` and `"cron": { "userSchedules": true }`
- **WHEN** the boot migration runs
- **THEN** the resulting `cron.userSchedules` remains `true` (new value preserved)
- **AND** the top-level `allowScheduledMessages` field is removed

#### Scenario: No legacy or new fields present

- **GIVEN** `data/config.json` contains neither legacy field nor a `cron` block
- **WHEN** the boot migration runs
- **THEN** the file is unchanged with respect to these keys
- **AND** the migration version is still incremented (the migration ran, just no-op)

#### Scenario: Migration runs only once

- **GIVEN** the migration has already run (the migration-version sentinel is set)
- **WHEN** the application boots again
- **THEN** the migration SHALL NOT re-run
- **AND** the config file is unchanged by this migration
