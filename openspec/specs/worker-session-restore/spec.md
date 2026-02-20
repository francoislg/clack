# worker-session-restore Specification

## Purpose

Restoring persisted worker sessions into memory on startup so that the Home Tab, follow-up actions, and completion monitor function correctly after a restart.

## Requirements

### Requirement: Worker Session Restoration on Startup

The system SHALL restore persisted worker sessions into memory on startup so that the Home Tab, follow-up actions, and completion monitor function correctly after a restart.

#### Scenario: Restore pr_created sessions
- **GIVEN** a persisted session with status `pr_created` and valid `channel` and `threadTs`
- **WHEN** the system starts up
- **THEN** the session SHALL be restored into the in-memory session Maps
- **AND** it SHALL appear in the Active Workers section of the Home Tab
- **AND** follow-up actions (merge, review, update, close) SHALL work for that session's thread

#### Scenario: Downgrade mid-execution sessions with PR
- **GIVEN** a persisted session with status `executing`, `planning`, `reviewing`, or `merging`
- **AND** the session has a non-null `prUrl`
- **AND** the session has valid `channel` and `threadTs`
- **WHEN** the system starts up
- **THEN** the session SHALL be restored with status `pr_created`
- **AND** the updated status SHALL be written to disk

#### Scenario: Mark mid-execution sessions without PR as failed
- **GIVEN** a persisted session with status `executing`, `planning`, `reviewing`, or `merging`
- **AND** the session has no `prUrl`
- **WHEN** the system starts up
- **THEN** the session SHALL NOT be restored into memory
- **AND** the session's status SHALL be updated to `failed` on disk
- **AND** the worktree SHALL be preserved for manual re-request

#### Scenario: Skip completed sessions
- **GIVEN** a persisted session with status `completed`
- **WHEN** the system starts up
- **THEN** the session SHALL NOT be restored into memory

#### Scenario: Skip failed sessions
- **GIVEN** a persisted session with status `failed`
- **WHEN** the system starts up
- **THEN** the session SHALL NOT be restored into memory

#### Scenario: Skip sessions missing Slack references
- **GIVEN** a persisted session that lacks `channel` or `threadTs` (legacy data)
- **WHEN** the system starts up
- **THEN** the session SHALL be silently skipped
- **AND** no error SHALL be logged

#### Scenario: Skip sessions with missing worktree
- **GIVEN** a persisted session with valid `channel` and `threadTs`
- **AND** the worktree directory no longer exists on disk
- **WHEN** the system starts up
- **THEN** the session SHALL NOT be restored into memory

#### Scenario: Skip sessions for unconfigured repositories
- **GIVEN** a persisted session referencing a repository that is no longer in the configuration
- **WHEN** the system starts up
- **THEN** the session SHALL NOT be restored into memory

#### Scenario: Restoration runs after worktree cleanup
- **WHEN** the system starts up with changes workflow enabled
- **THEN** worker session restoration SHALL run after `initializeWorktrees()` completes
- **AND** before `startCompletionMonitor()` is called

#### Scenario: Restoration errors are non-fatal
- **GIVEN** an error occurs during session restoration
- **WHEN** the system starts up
- **THEN** the error SHALL be logged as a warning
- **AND** startup SHALL continue normally
