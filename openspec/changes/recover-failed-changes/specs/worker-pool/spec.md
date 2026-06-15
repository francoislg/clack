# worker-pool Delta

## MODIFIED Requirements

### Requirement: Worker Release Lifecycle

The system SHALL release a worker on PR merge, PR close, idle timeout, cancellation, discard, or failure — preserving the folder in all cases. The idle-release sweep SHALL cover workers claimed by sessions whose change status is `pr_created` OR `failed`. For failed-session releases, a branch with committed-but-unpushed work SHALL be treated as dirty and quarantined rather than released.

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

#### Scenario: Idle release covers failed sessions (clean, fully pushed)
- **GIVEN** a worker is busy with `claimedBy` set
- **AND** the claim's session has `activeChange.status === "failed"` and no live `handle`
- **AND** `lastUsedAt` is older than `idleReleaseHours` ago
- **AND** the worker passes the dirty-check
- **AND** the worker's branch has no commits ahead of its upstream
- **WHEN** the idle-release sweep runs
- **THEN** the worker is released like a clean `pr_created` idle release (detach, switch to `origin/<defaultBranch>`)

#### Scenario: Failed-session release with unpushed commits quarantines
- **GIVEN** a worker claimed by a `failed` session that is past the idle window
- **AND** the worker's branch has committed-but-unpushed work (ahead of upstream, or no upstream)
- **WHEN** the idle-release sweep runs
- **THEN** the worker is quarantined instead of released
- **AND** the unpushed commits are preserved

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

### Requirement: Setup-Version Invalidation

The system SHALL re-run worker setup when the per-repo `worktree_setup_instructions.md` content hash differs from the worker's recorded `setupVersionHash`. The hash check SHALL run on EVERY acquire path that claims a worker — including the branch-sticky path (worker already on the requested branch) — and on the recovery paths (`continue`, `restart`) before re-entering execution.

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

#### Scenario: Branch-sticky acquire heals stale setup
- **GIVEN** an idle worker already checked out on the requested branch
- **AND** its `setupVersionHash` does not match the current instructions hash
- **WHEN** acquire claims it via the branch-sticky path
- **THEN** setup re-runs and the install step runs before the worker is handed out

#### Scenario: Recovery path heals stale setup
- **GIVEN** a failed change whose worker has a stale `setupVersionHash`
- **WHEN** a `continue` or `restart` recovery command runs
- **THEN** the setup-version check executes (re-running setup on mismatch) before Claude executes

#### Scenario: Missing instructions file
- **WHEN** the per-repo setup instructions file does not exist
- **THEN** `setupVersionHash` is set to a sentinel value (`sha256("")`)
- **AND** the worker is treated as setup-complete with no actions to run
- **AND** if the file is later created, the next acquire detects the hash mismatch and re-runs setup with the new hash recorded
