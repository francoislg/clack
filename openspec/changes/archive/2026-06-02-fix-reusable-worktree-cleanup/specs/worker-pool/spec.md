## ADDED Requirements

### Requirement: Pool Folders Exempt from Stale-Worktree Cleanup

The global stale-worktree cleanup sweep SHALL NOT delete reusable pool `worker-N` folders when reusable mode is enabled. The reusable pool is the sole owner of those folders' lifecycle (idle release and quarantine); the mtime-based sweep applies only to non-pool worktree directories.

#### Scenario: Stale sweep skips pool folders in reusable mode
- **GIVEN** `changesWorkflow.reusableFolders.enabled` is true
- **AND** a folder `data/worktrees/<R>/worker-<N>` has a directory mtime older than `sessionExpiryHours`
- **WHEN** the boot-time stale-worktree cleanup sweep runs
- **THEN** the `worker-<N>` folder is NOT deleted
- **AND** the folder remains available for the in-memory pool to acquire and branch-switch

#### Scenario: Stale sweep still reaps non-pool folders in reusable mode
- **GIVEN** `changesWorkflow.reusableFolders.enabled` is true
- **AND** a non-`worker-N` folder (e.g. a leftover per-branch directory from a prior disposable-mode run) has a directory mtime older than `sessionExpiryHours`
- **WHEN** the boot-time stale-worktree cleanup sweep runs
- **THEN** that folder is removed
- **AND** orphaned git worktree references are pruned

#### Scenario: Disposable mode cleanup unchanged
- **GIVEN** `changesWorkflow.reusableFolders.enabled` is false
- **WHEN** the boot-time stale-worktree cleanup sweep runs
- **THEN** every stale folder under `data/worktrees/<repo>/` is subject to deletion exactly as before this change

### Requirement: Acquire Self-Heals on Missing Worker Folder

The system SHALL verify that a selected idle worker's folder exists on disk before reusing or branch-switching it. When the folder is absent, the worker SHALL be dropped from the pool and acquire SHALL fall through to provisioning a fresh worker, rather than surfacing a git-construction error.

#### Scenario: Idle worker folder missing on acquire
- **GIVEN** the in-memory pool lists an idle `worker-<N>` for repo `<R>`
- **AND** the folder `data/worktrees/<R>/worker-<N>` no longer exists on disk
- **WHEN** `acquire` selects that worker (directly or via branch lookup)
- **THEN** the worker is removed from the in-memory pool and `data/state/workers.json` is updated
- **AND** acquire continues its decision tree, creating a new worker when below `maxConcurrent`
- **AND** no "Cannot use simple-git on a directory that does not exist" error reaches the caller

#### Scenario: Change request succeeds after self-heal
- **GIVEN** a change request targets a repo whose only idle worker has a missing folder
- **WHEN** the change workflow acquires a worker
- **THEN** acquisition succeeds with a freshly provisioned worker
- **AND** the change proceeds without a "Failed to create workspace" failure
