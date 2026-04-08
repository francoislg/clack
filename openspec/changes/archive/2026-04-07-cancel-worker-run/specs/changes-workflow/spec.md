## MODIFIED Requirements

### Requirement: Worker Visibility

The system SHALL provide real-time visibility into change execution progress.

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

## ADDED Requirements

### Requirement: Cancelled Change Status

The system SHALL support `"cancelled"` as a terminal `ChangeStatus` distinct from `"failed"`.

#### Scenario: Cancelled is terminal for blocking purposes
- **WHEN** a change has status `"cancelled"`
- **THEN** it does not block new change requests from the same user
- **AND** it is skipped during session restoration on startup
- **AND** the worktree and session folder are preserved (not cleaned up) so the user can resume by requesting the same change again

#### Scenario: Phase mapping
- **WHEN** `statusToPhase` is called with `"cancelled"`
- **THEN** it returns `"Cancelled"`

#### Scenario: Workflow sets cancelled status
- **WHEN** a worker execution returns after being aborted
- **AND** `activeChange.cancelledBy` is set
- **THEN** `workflow.ts` sets the status to `"cancelled"` (not `"failed"`)
- **AND** returns `ChangeResult` with `cancelled: true` and `cancelledBy` info

#### Scenario: ChangeResult carries cancellation info
- **WHEN** a cancelled `ChangeResult` is returned
- **THEN** it includes `cancelled: true` and `cancelledBy: { userId, reason? }`
- **AND** the calling handler uses this to format the Slack message

#### Scenario: Cancellation during follow-up sets cancelled status
- **GIVEN** a change has status `pr_created` and a follow-up command (review, update, merge) is executing
- **WHEN** the follow-up execution is cancelled
- **THEN** the change status is set to `"cancelled"` regardless of prior status
- **AND** the PR remains on GitHub in its current state
- **AND** the user can request a new follow-up action in the same thread later
