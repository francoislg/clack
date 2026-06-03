# worker-pool Specification

## Purpose

Long-lived reusable worker pools for the Changes Workflow — an alternative to the disposable-per-branch model. Workers persist across multiple change requests, each starting from a clean origin/<default> state. The pool manages acquisition, branch switching, idle release, dirty quarantine, and visibility.

## Requirements

### Requirement: Worker Pool Configuration

The system SHALL support `changesWorkflow.reusableFolders` configuration that selects between the disposable per-branch worktree model (default) and the reusable worker-pool model.

#### Scenario: Default disposable model
- **WHEN** `changesWorkflow.reusableFolders` is absent or `enabled: false`
- **THEN** worktree creation, naming, and cleanup follow the disposable model unchanged
- **AND** no worker pool state file is written

#### Scenario: Enable reusable pool
- **WHEN** `changesWorkflow.reusableFolders.enabled` is `true`
- **THEN** the system uses the reusable worker pool for all change requests
- **AND** honors `minimumProvisioned`, `maxConcurrent`, `maxQueueDepth`, `idleReleaseHours`, and `dirtyTrackedQuarantine` from the same config block

#### Scenario: Default values
- **WHEN** `reusableFolders` is enabled but individual fields are omitted
- **THEN** defaults apply: `minimumProvisioned: 0`, `maxConcurrent: 3`, `maxQueueDepth: 5`, `idleReleaseHours: 24`, `dirtyTrackedQuarantine: true`

### Requirement: Worker Identity and Folder Layout

The system SHALL allocate workers as long-lived folders named `worker-N` per repository under `data/worktrees/<repo>/`.

#### Scenario: Worker folder naming
- **WHEN** a new worker is created for repo `<R>`
- **THEN** its folder path is `data/worktrees/<R>/worker-<N>` where `N` is the smallest positive integer not already in use for that repo
- **AND** the folder persists across acquire/release cycles

#### Scenario: Folder is preserved on release
- **WHEN** a worker is released for any reason
- **THEN** its folder is NOT deleted
- **AND** `node_modules` and other untracked artifacts remain in place

### Requirement: Worker State Persistence

The system SHALL persist worker pool state to `data/state/workers.json` and to `.clack-worker-state.json` inside each worker folder.

#### Scenario: State written on transitions
- **WHEN** a worker's status, claim, or current branch changes
- **THEN** `data/state/workers.json` is updated atomically
- **AND** the worker's `.clack-worker-state.json` is updated

#### Scenario: Disk wins over state file at boot
- **GIVEN** `data/state/workers.json` records `currentBranch: A` for `worker-N`
- **AND** `git rev-parse --abbrev-ref HEAD` in `worker-N` returns `B`
- **WHEN** the system starts up
- **THEN** the in-memory pool reflects `currentBranch: B`
- **AND** the discrepancy is logged at warn level
- **AND** `data/state/workers.json` is rewritten to match disk

#### Scenario: Orphan folder adoption
- **GIVEN** a folder `data/worktrees/<R>/worker-<N>` exists on disk
- **AND** `data/state/workers.json` has no entry for it
- **WHEN** the system starts up
- **THEN** the folder is adopted as an `idle` worker
- **AND** its `currentBranch` is set from `git rev-parse --abbrev-ref HEAD`

#### Scenario: Orphan state entry pruning
- **GIVEN** `data/state/workers.json` has an entry for `worker-<N>`
- **AND** the corresponding folder no longer exists on disk
- **WHEN** the system starts up
- **THEN** the state entry is removed
- **AND** the removal is logged at info level

### Requirement: Boot-Time Provisioning

The system SHALL asynchronously provision workers up to `minimumProvisioned` per repository at startup.

#### Scenario: Provisioning is non-blocking
- **WHEN** the system starts up with `reusableFolders.enabled: true` and `minimumProvisioned: 2`
- **THEN** startup proceeds without waiting for worker setup to complete
- **AND** workers are created with status `initializing` and a `readyPromise`
- **AND** their setup runs in the background, transitioning each to `idle` on success

#### Scenario: Acquire awaits initializing workers
- **WHEN** `acquire` is called and at least one worker for the target repo is `initializing`
- **AND** no worker is `idle`
- **AND** the pool size is at `maxConcurrent` OR the caller chooses to wait
- **THEN** acquire awaits the first initializing worker's `readyPromise`
- **AND** does not spawn a parallel worker setup

#### Scenario: Setup failure marks worker failed
- **WHEN** a worker's setup throws or exits non-zero
- **THEN** the worker's status is set to `failed`
- **AND** the worker is excluded from acquire
- **AND** the failure is visible in the Home Tab worker list

#### Scenario: Already-provisioned at boot
- **GIVEN** existing worker folders on disk that satisfy `minimumProvisioned`
- **WHEN** the system starts up
- **THEN** no new workers are provisioned for that repo
- **AND** existing workers are restored (per state persistence requirement)

### Requirement: Worker Acquire Decision Tree

The system SHALL acquire a worker for a (repo, branch, sessionId) request via a deterministic decision tree.

#### Scenario: Branch already on an idle worker
- **GIVEN** an idle worker has `currentBranch === <branch>`
- **WHEN** acquire is called
- **THEN** that worker is claimed without a branch switch
- **AND** the worker's status transitions from `idle` to `busy` with `claimedBy` set to the requesting sessionId
- **AND** the call returns the same worker reference

#### Scenario: Branch already on a busy worker
- **GIVEN** a busy worker has `currentBranch === <branch>` and a different sessionId claimed it
- **WHEN** acquire is called
- **THEN** the call rejects with an "already in flight" error

#### Scenario: Idle worker available, switch branch
- **GIVEN** at least one idle worker exists for the repo
- **AND** none has `currentBranch === <branch>`
- **WHEN** acquire is called
- **THEN** the first idle worker is selected
- **AND** its branch is switched to `<branch>` per the branch-switching requirement
- **AND** the worker is then claimed

#### Scenario: No idle, room to grow
- **GIVEN** no idle workers for the repo
- **AND** no initializing workers for the repo
- **AND** the current pool size is below `maxConcurrent`
- **WHEN** acquire is called
- **THEN** a new worker is created (`worker-<next-N>`) with status `initializing`
- **AND** setup runs to completion before the worker is claimed

#### Scenario: Pool saturated, queue available
- **GIVEN** no idle, no initializing workers for the repo
- **AND** the pool size is at `maxConcurrent`
- **AND** the queue depth is below `maxQueueDepth`
- **WHEN** acquire is called
- **THEN** the request is enqueued FIFO per repo
- **AND** the awaiter resolves when a worker is released

#### Scenario: Pool exhausted, queue full
- **GIVEN** the pool is at `maxConcurrent` and the queue is at `maxQueueDepth`
- **WHEN** acquire is called
- **THEN** the call rejects with a `PoolExhausted` error
- **AND** the caller surfaces a user-facing message that the pool is at capacity

### Requirement: Branch Switching with Dirty-Worker Quarantine

The system SHALL refuse to switch branches on a worker with modified-tracked files and SHALL quarantine that worker.

#### Scenario: Clean worker switches branch
- **GIVEN** `git diff --quiet HEAD` succeeds (no modified-tracked files)
- **WHEN** the worker switches from branch A to branch B
- **THEN** the system runs `git fetch origin`
- **AND** runs `git checkout -B <B> origin/<defaultBranch>`
- **AND** updates `worker.currentBranch`
- **AND** untracked files are preserved (not cleaned)

#### Scenario: Dirty worker is quarantined
- **GIVEN** `git diff --quiet HEAD` reports modified-tracked files
- **WHEN** a branch switch is attempted on the worker
- **THEN** the worker's status is set to `quarantined`
- **AND** `.clack-quarantine.json` is written to the worker folder containing the file list
- **AND** acquire excludes the worker until the quarantine clears
- **AND** the calling acquire path falls through to the next decision step (try another idle, grow, or queue)

#### Scenario: Dirty-ignore overrides
- **GIVEN** `data/configuration/<repo>/worktree_dirty_ignore.txt` exists with glob entries
- **WHEN** dirty detection runs
- **THEN** files matching the globs are excluded from the dirty count
- **AND** quarantine triggers only if non-ignored modified-tracked files remain

#### Scenario: Same branch, no switch
- **WHEN** the worker's `currentBranch` already equals the requested branch
- **THEN** no `git checkout` is performed
- **AND** no dirty check is performed (the worker keeps its in-progress state)

### Requirement: Worker Release Lifecycle

The system SHALL release a worker on PR merge, PR close, idle timeout, cancellation, or failure — preserving the folder in all cases.

#### Scenario: Release on PR merged
- **GIVEN** a worker is busy on a branch whose PR has been merged
- **WHEN** the completion monitor detects the merge
- **THEN** `pool.release(worker, "pr_merged")` is called
- **AND** the worker's claim is cleared
- **AND** the worker's status becomes `idle` (or `quarantined` if dirty)
- **AND** the worker folder is NOT deleted

#### Scenario: Release on PR closed
- **GIVEN** a worker is busy on a branch whose PR has been closed without merging
- **WHEN** the completion monitor detects the close
- **THEN** `pool.release(worker, "pr_closed")` is called
- **AND** the worker's claim is cleared and status returns to `idle` (or `quarantined`)

#### Scenario: Idle release after timeout (clean worker)
- **GIVEN** a worker is busy with `claimedBy` set
- **AND** the claim's session has `activeChange.status === "pr_created"` and no live `handle`
- **AND** `lastUsedAt` is older than `idleReleaseHours` ago
- **AND** the worker passes the dirty-check (no modified-tracked files)
- **WHEN** the idle-release sweep runs
- **THEN** the worker is detached from the session
- **AND** the worker is switched back to `origin/<defaultBranch>` to free the branch ref
- **AND** the session's `activeChange.worktree` is marked detached

#### Scenario: Idle release on dirty worker quarantines
- **GIVEN** a worker is busy with `claimedBy` set
- **AND** the claim's session has `activeChange.status === "pr_created"` and no live `handle`
- **AND** `lastUsedAt` is older than `idleReleaseHours` ago
- **AND** the worker fails the dirty-check (has modified-tracked files)
- **WHEN** the idle-release sweep runs
- **THEN** the worker is quarantined per the branch-switch quarantine path
- **AND** the session's claim is retained (NOT detached) until the quarantine is cleared

#### Scenario: Release rejected for in-flight work
- **GIVEN** a worker's claim has a live `ClaudeRunHandle`
- **WHEN** the idle-release sweep runs
- **THEN** the worker is NOT released regardless of `lastUsedAt`

#### Scenario: Release on cancellation
- **GIVEN** a worker's claim was cancelled via `handle.stop`
- **WHEN** the workflow returns its cancelled `ChangeResult`
- **THEN** `pool.release(worker, "cancelled")` is called
- **AND** the folder is preserved
- **AND** the worker remains checked out on the cancelled branch (no switch back to default), allowing the user to resume by requesting the same branch again

### Requirement: Local Branch Lookup

The system SHALL provide `pool.findByBranch(repo, branch)` returning a worker that currently has the branch checked out, used by query tools to prefer local reads over GitHub API calls.

#### Scenario: Branch is on a worker
- **WHEN** `findByBranch(repo, branch)` is called
- **AND** a worker for `repo` has `currentBranch === branch` and status is not `quarantined`
- **THEN** the call returns that worker

#### Scenario: Branch not on any worker
- **WHEN** `findByBranch(repo, branch)` is called
- **AND** no worker for `repo` has the branch checked out (or all matching are `quarantined`)
- **THEN** the call returns `null`

#### Scenario: git_log uses local worker when available
- **GIVEN** `git_log` is invoked for a branch that is currently on `worker-N`
- **WHEN** the tool runs
- **THEN** it reads from `worker-N`'s worktree path instead of fetching via GitHub API

### Requirement: Setup-Version Invalidation

The system SHALL re-run worker setup when the per-repo `worktree_setup_instructions.md` content hash differs from the worker's recorded `setupVersionHash`.

#### Scenario: Hash matches, setup skipped
- **GIVEN** a worker with `setupVersionHash === sha256(currentInstructions)`
- **WHEN** acquire claims it
- **THEN** setup is NOT re-run

#### Scenario: Hash differs, setup re-runs
- **GIVEN** a worker with `setupVersionHash` that does not match the current instructions hash
- **WHEN** acquire claims it
- **THEN** the worker is marked `initializing`
- **AND** setup runs to completion
- **AND** `setupVersionHash` is updated to the current hash

#### Scenario: Missing instructions file
- **WHEN** the per-repo setup instructions file does not exist
- **THEN** `setupVersionHash` is set to a sentinel value (`sha256("")`)
- **AND** the worker is treated as setup-complete with no actions to run
- **AND** if the file is later created, the next acquire detects the hash mismatch and re-runs setup with the new hash recorded

### Requirement: Quarantine Lifecycle

The system SHALL exclude quarantined workers from acquire and SHALL provide an admin clear path.

#### Scenario: Quarantine notification
- **WHEN** a worker enters `quarantined` status
- **THEN** the system DMs every user with `admin` or `owner` role with the worker ID, repo, branch, and dirty file list
- **AND** the same information is written to `.clack-quarantine.json` in the worker folder

#### Scenario: Quarantine excludes from acquire
- **GIVEN** a worker has status `quarantined`
- **WHEN** acquire runs
- **THEN** the worker is skipped at every step of the decision tree (idle pick, branch lookup, switch target)

#### Scenario: Admin clear discards changes
- **WHEN** an admin clicks "Discard changes & restore worker-N" in the Home Tab
- **THEN** the system runs `git reset --hard HEAD` and `git clean -fd` (excluding ignored files) on the worker
- **AND** removes `.clack-quarantine.json`
- **AND** sets the worker status to `idle`

#### Scenario: Manual clear via file removal
- **WHEN** `.clack-quarantine.json` is deleted from a worker folder out of band
- **AND** the system reconciles the worker on next operation
- **THEN** the worker re-enters `idle` status if no modified-tracked files remain

### Requirement: Pool Visibility in Home Tab

The system SHALL render pool state in the Home Tab.

#### Scenario: Per-repo worker section
- **GIVEN** the reusable pool is enabled
- **WHEN** an admin views the Home Tab
- **THEN** each repo with workers shows: total slots, idle count, busy count, initializing count, quarantined count, queue depth

#### Scenario: Queued requests visible
- **WHEN** the queue depth for any repo is greater than 0
- **THEN** the Home Tab shows the queued requests with requesting user, branch, queue position, and queueing timestamp

#### Scenario: Quarantine action button
- **GIVEN** a worker has status `quarantined`
- **WHEN** an admin views the Home Tab
- **THEN** a "Discard & restore" action button is shown next to that worker
- **AND** clicking it triggers the admin clear path

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

### Requirement: Worker-pool state loading is schema-driven

`workers/persistence.ts` SHALL parse `workers.json` against a zod schema (`WorkersState` with `version`, `workers[]`; `PersistedWorker` with enum `status` and ISO-date `lastUsedAt`/`createdAt` transformed to `Date`) instead of the hand-rolled `isObject`/`isStatus`/`isPersistedWorker`/`isWorkersState` type guards. Graceful degradation SHALL be preserved: on parse failure the loader logs a warning and returns an empty pool (it MUST NOT throw), and a valid file MUST parse to the identical in-memory shape including `Date` coercion.

#### Scenario: Corrupt state degrades, does not throw

- **WHEN** `workers.json` is malformed or fails the schema
- **THEN** the loader logs a warning and returns `[]` (empty pool), exactly as today — startup is unaffected

#### Scenario: Valid state round-trips with Date coercion

- **WHEN** a valid `workers.json` is loaded
- **THEN** every worker is returned with `status` validated and `lastUsedAt`/`createdAt` as `Date` objects, byte-equal to the pre-migration result

#### Scenario: Malformed date strings behave exactly as today

- **WHEN** a worker entry carries an unparseable `lastUsedAt`/`createdAt` string
- **THEN** the loader's handling matches the pre-migration `new Date(string)` behavior exactly (the schema's date transform MUST NOT newly reject an entry that the current loader accepts) — the characterization gate pins whether that yields an Invalid Date or drops the entry
