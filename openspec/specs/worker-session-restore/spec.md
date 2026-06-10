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

#### Scenario: Skip sessions with missing worktree (disposable mode)
- **GIVEN** a persisted session with valid `channel` and `threadTs`
- **AND** `reusableFolders.enabled` is `false`
- **AND** the worktree directory no longer exists on disk
- **WHEN** the system starts up
- **THEN** the session SHALL NOT be restored into memory

#### Scenario: Restore detached when worker missing (reusable mode)
- **GIVEN** a persisted session with valid `channel` and `threadTs` and status `pr_created`
- **AND** `reusableFolders.enabled` is `true`
- **AND** no worker currently has the session's branch checked out
- **WHEN** the system starts up
- **THEN** the session SHALL be restored as detached (`activeChange.worktree` unset)
- **AND** the session SHALL still appear in the Home Tab Active Workers section, marked as detached

#### Scenario: Skip sessions for unconfigured repositories
- **GIVEN** a persisted session referencing a repository that is no longer in the configuration
- **WHEN** the system starts up
- **THEN** the session SHALL NOT be restored into memory

#### Scenario: Restoration runs after worktree cleanup
- **WHEN** the system starts up with changes workflow enabled
- **THEN** worker session restoration SHALL run after `initializeWorktrees()` completes
- **AND** before `startCompletionMonitor()` is called
- **AND** when `reusableFolders.enabled` is `true`, pool reconciliation SHALL run before session restoration

#### Scenario: Restoration errors are non-fatal
- **GIVEN** an error occurs during session restoration
- **WHEN** the system starts up
- **THEN** the error SHALL be logged as a warning
- **AND** startup SHALL continue normally

### Requirement: Change-session state load is schema-driven

`parseSessionState` SHALL validate persisted change-session state against a `PersistedSessionState` zod schema rather than the hand-rolled `isValidSessionState` three-field guard, preserving its graceful contract: a parse error or shape mismatch SHALL return `null` (the session is treated as unresumable) and log at debug, never throw.

#### Scenario: Corrupt change-session state is unresumable, not fatal

- **WHEN** a persisted change-session file is not valid JSON or is missing required fields
- **THEN** `parseSessionState` returns `null` exactly as today, and restore skips that session

#### Scenario: A valid persisted change session round-trips

- **WHEN** a change-session file written by a prior build is read
- **THEN** the parsed `PersistedSessionState` matches the pre-migration result

## ADDED Requirements

### Requirement: Pool-First Restoration Order

The system SHALL restore the worker pool state from disk before restoring change sessions, when `changesWorkflow.reusableFolders.enabled` is `true`.

#### Scenario: Pool restored first
- **WHEN** the system starts up with `reusableFolders.enabled: true`
- **THEN** the pool reads `data/state/workers.json` and reconciles with disk
- **AND** worker entries are populated in memory before session restoration begins

#### Scenario: Session-to-worker rematch
- **GIVEN** a persisted session has `activeChange.branch` set
- **AND** a worker exists with `currentBranch` equal to that branch
- **WHEN** the session is restored
- **THEN** the session's `activeChange.worktree` is rebuilt to point to that worker's path
- **AND** the worker's claim is set to that session

#### Scenario: Detached session on restore
- **GIVEN** a persisted session in `pr_created` status with a branch that no worker currently has
- **WHEN** the system starts up
- **THEN** the session is restored as detached (no `activeChange.worktree`)
- **AND** the next follow-up command will trigger a fresh `pool.acquire`

#### Scenario: Conflicting claim resolution
- **GIVEN** two persisted sessions appear to claim the same worker by branch
- **WHEN** restoration runs
- **THEN** the session with the later `lastActivityAt` keeps the worker
- **AND** the older session is restored as detached
- **AND** the conflict is logged at warn level
