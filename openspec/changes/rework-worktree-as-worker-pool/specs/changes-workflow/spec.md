## ADDED Requirements

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

#### Scenario: Disposable mode behaves as before
- **GIVEN** `reusableFolders.enabled` is `false` or unset
- **WHEN** the workflow runs any change
- **THEN** behavior matches the pre-change disposable model exactly
- **AND** no pool state is read or written

### Requirement: Detached Session Re-Acquire

The system SHALL support follow-up commands on sessions whose worker was detached during idle release.

#### Scenario: Re-acquire on follow-up
- **GIVEN** a session's `activeChange.worktree` is marked detached (post idle-release)
- **WHEN** any follow-up command (`review`, `update`, `merge`, `close`) executes
- **THEN** the workflow calls `pool.acquire(repo, branch, sessionId)`
- **AND** the returned worker is used for the command

#### Scenario: Re-acquire when pool is saturated
- **GIVEN** a detached session triggers a follow-up
- **AND** the pool is at `maxConcurrent` with no idle workers
- **WHEN** acquire is called
- **THEN** the request enqueues per the pool's queue rules
- **AND** the user is notified that the action is queued

### Requirement: Queue Acknowledgment

The system SHALL inform the user when a change request is enqueued.

#### Scenario: Initial Slack ack on queue
- **WHEN** a change request is enqueued by the pool
- **THEN** the orchestrator posts a status message indicating the request is queued and its position
- **AND** a follow-up status is posted when the request is dequeued and execution begins

#### Scenario: Pool-exhausted message
- **WHEN** the pool rejects with `PoolExhausted`
- **THEN** the orchestrator returns `{ success: false, error: <message indicating capacity is full> }`
- **AND** the Slack response surfaces the error to the user

## MODIFIED Requirements

### Requirement: Changes Workflow Configuration

The system SHALL support a top-level configuration section for the change request workflow.

#### Scenario: Top-level workflow configuration
- **WHEN** `changesWorkflow` is configured at the root config level
- **THEN** it defines the global workflow behavior
- **AND** includes: `enabled`, `timeoutMinutes`, `additionalAllowedTools`, `sessionExpiryHours`, `monitoringIntervalMinutes`, `reusableFolders`

#### Scenario: Disable workflow globally (default)
- **WHEN** `changesWorkflow` is not configured or `enabled` is `false`
- **THEN** all messages are treated as Q&A queries regardless of trigger settings
- **AND** no change execution occurs

#### Scenario: Per-trigger opt-in for direct messages
- **GIVEN** `changesWorkflow.enabled` is `true` at root level
- **WHEN** `directMessages.changesWorkflow.enabled` is `true`
- **THEN** the system enables change detection for DMs from dev users
- **AND** Claude uses semantic analysis to identify change requests vs questions

#### Scenario: Per-trigger opt-in for mentions
- **GIVEN** `changesWorkflow.enabled` is `true` at root level
- **WHEN** `mentions.changesWorkflow.enabled` is `true`
- **THEN** the system enables change detection for mentions from dev users
- **AND** Claude uses semantic analysis to identify change requests vs questions

#### Scenario: Per-trigger opt-in for reactions with custom trigger
- **GIVEN** `changesWorkflow.enabled` is `true` at root level
- **WHEN** `reactions.changesWorkflow.enabled` is `true`
- **THEN** the system listens for the `reactions.changesWorkflow.trigger` emoji
- **AND** processes the reacted message as a change request
- **AND** uses a different emoji than the Q&A trigger

#### Scenario: Reactions change trigger configuration
- **WHEN** `reactions.changesWorkflow.trigger` is configured
- **THEN** that emoji triggers change requests (e.g., "clack-work")
- **AND** the regular `reactions.trigger` emoji triggers Q&A queries

#### Scenario: Trigger disabled but workflow enabled
- **GIVEN** `changesWorkflow.enabled` is `true` at root level
- **AND** `directMessages.changesWorkflow.enabled` is `false` or not set
- **WHEN** a user sends a DM
- **THEN** all messages are treated as Q&A queries for that trigger type

#### Scenario: Execution timeout configuration
- **WHEN** `changesWorkflow.timeoutMinutes` is configured
- **THEN** the system uses that value as the maximum execution time
- **AND** defaults to 10 minutes if not specified

#### Scenario: Additional allowed tools
- **WHEN** `changesWorkflow.additionalAllowedTools` is configured as an array
- **THEN** those tools are added to the default allowed tools for change execution
- **AND** allows enabling tools like `WebFetch`, `WebSearch` for changes

#### Scenario: Session expiry configuration
- **WHEN** `changesWorkflow.sessionExpiryHours` is configured
- **THEN** idle sessions are cleaned up after that period
- **AND** defaults to 24 hours if not specified

#### Scenario: Monitoring interval configuration
- **WHEN** `changesWorkflow.monitoringIntervalMinutes` is configured
- **THEN** the completion monitor runs at that interval
- **AND** defaults to 15 minutes if not specified
- **AND** set to 0 to disable monitoring

#### Scenario: Reusable folders configuration block
- **WHEN** `changesWorkflow.reusableFolders` is configured
- **THEN** it accepts: `enabled` (bool), `minimumProvisioned` (int), `maxConcurrent` (int), `maxQueueDepth` (int), `idleReleaseHours` (int), `dirtyTrackedQuarantine` (bool)
- **AND** when `enabled` is `false` or absent, the disposable per-branch worktree model is used

### Requirement: Worker Visibility

The system SHALL provide real-time visibility into change execution progress, including pool state when reusable folders are enabled.

#### Scenario: Session state persistence
- **WHEN** a change session is created
- **THEN** the system creates `data/worktree-sessions/{branch-name}/state.json`
- **AND** the state includes: sessionId, status, phase, branch, repo, userId, description, prUrl, startedAt, lastActivityAt, lastMessage, channel, threadTs, cancelledBy

#### Scenario: State updates during execution
- **WHEN** the session status changes (planning → executing → pr_created → etc., or cancelled from any active state)
- **THEN** the system updates `state.json` with new status and phase
- **AND** updates `lastActivityAt` timestamp

#### Scenario: Execution logging
- **WHEN** Claude produces output during change execution
- **THEN** the system appends to `data/worktree-sessions/{branch-name}/execution.log`
- **AND** each log entry includes a timestamp in ISO format

#### Scenario: Session folder cleanup on success
- **GIVEN** a change session completes successfully (merged or closed)
- **WHEN** the session is removed
- **THEN** the session folder is deleted from `data/worktree-sessions/`

#### Scenario: Session folder preserved on failure or cancellation
- **GIVEN** a change session fails or is cancelled
- **WHEN** cleanup runs
- **THEN** the session folder is NOT deleted
- **AND** the folder is preserved indefinitely for debugging
- **AND** manual deletion is required to remove it

#### Scenario: Active workers display
- **GIVEN** a user with dev role views the Home tab
- **WHEN** there are active change sessions
- **THEN** the Home tab shows a "Active Workers" section
- **AND** each worker shows: status, description, branch, repo, user, and PR link (if available)
- **AND** cancelled workers display with a distinct emoji and "Cancelled" label

#### Scenario: Cancellation metadata persisted
- **WHEN** a worker execution is cancelled
- **THEN** `state.json` includes `cancelledBy: { userId, reason? }`
- **AND** `execution.log` records "Cancelled by <userId>: <reason>"
- **AND** status is set to `"cancelled"` (distinct from `"failed"`)

#### Scenario: Pool state visible when reusable folders enabled
- **GIVEN** `reusableFolders.enabled` is `true` and the viewer is admin or owner
- **WHEN** the Home Tab renders
- **THEN** a "Worker Pool" section is shown listing per-repo slot counts (idle, busy, initializing, quarantined) and queue depth
- **AND** the disposable-mode Active Workers section is hidden when the pool is enabled
