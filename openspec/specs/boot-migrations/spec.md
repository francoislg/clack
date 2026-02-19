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
- **THEN** it SHALL export an object with: version (integer), name (string), priority ("blocking" or "enhancement"), prompt (string), and files (string array)

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

The system SHALL use Claude to execute each migration.

#### Scenario: Execute migration prompt
- **WHEN** a migration is executed
- **THEN** the system invokes Claude with the migration's prompt
- **AND** provides system instructions explaining the migration context
- **AND** scopes file access to the migration's files array

#### Scenario: File scope enforcement
- **WHEN** Claude executes a migration
- **THEN** Claude can only read and write files listed in the migration's files array

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
- **AND** generates a new migration file with version, name, priority, prompt, and files
- **AND** registers the migration in the barrel export
