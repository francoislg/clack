# changes-workflow Delta

## ADDED Requirements

### Requirement: Failed Change Status Is Recoverable

The `failed` status SHALL NOT be terminal. The follow-up guard SHALL admit the recovery commands (`continue`, `restart`, `discard`) when the change status is `failed`, while continuing to reject all other follow-up commands (`review`, `update`, `merge`, `close`) on a failed change. `completed` and `cancelled` SHALL remain terminal for every command.

#### Scenario: Recovery command admitted on failed change

- **GIVEN** a session whose `activeChange.status` is `failed`
- **WHEN** `handleFollowUp` receives a recovery command
- **THEN** the command proceeds instead of returning the terminal-status error

#### Scenario: Non-recovery command still rejected on failed change

- **GIVEN** a session whose `activeChange.status` is `failed`
- **WHEN** `handleFollowUp` receives `review`, `update`, `merge`, or `close`
- **THEN** it returns an error stating the change failed and offering the recovery actions

#### Scenario: Completed and cancelled remain terminal

- **GIVEN** a session whose `activeChange.status` is `completed` or `cancelled`
- **WHEN** `handleFollowUp` receives any command, including recovery commands
- **THEN** it returns the terminal-status error

#### Scenario: Failed session retains its active change for recovery

- **GIVEN** a change whose execution failed
- **WHEN** the failure is recorded
- **THEN** the session's `activeChange` (branch, repo, worktree, persisted state) is retained, not cleared

## MODIFIED Requirements

### Requirement: Worker Pool Mediation

The system SHALL route worktree acquisition and release through `WorkerPool` when `changesWorkflow.reusableFolders.enabled` is `true`.

#### Scenario: Acquire via pool on change start
- **GIVEN** `reusableFolders.enabled` is `true`
- **WHEN** `startChangeWorkflow` reaches the worktree-acquisition step
- **THEN** it calls `pool.acquire(repo, branch, sessionId)` instead of `createWorktree`
- **AND** the returned `Worker.worktreePath` is recorded on `activeChange.worktree`

#### Scenario: Release via pool on PR completion
- **GIVEN** `reusableFolders.enabled` is `true`
- **WHEN** the completion monitor detects a PR was merged or closed externally
- **THEN** it calls `pool.release(worker, "pr_merged" | "pr_closed")` instead of `removeWorktree`

#### Scenario: Release via pool on follow-up merge or close
- **GIVEN** `reusableFolders.enabled` is `true`
- **WHEN** the merge or close follow-up command completes successfully
- **THEN** the workflow calls `pool.release(worker, "pr_merged" | "pr_closed")` for the active worker

#### Scenario: Release via pool on discard
- **GIVEN** `reusableFolders.enabled` is `true`
- **WHEN** the `discard` recovery command runs on a failed change
- **THEN** the workflow calls `pool.release(worker, "discarded")` for the active worker
- **AND** the standard release dirty-check applies (clean → `idle`, dirty-tracked → quarantine)

#### Scenario: Disposable mode behaves as before
- **GIVEN** `reusableFolders.enabled` is `false` or unset
- **WHEN** the workflow runs any change
- **THEN** behavior matches the pre-change disposable model exactly
- **AND** no pool state is read or written
