# worker-cancellation Specification

## Purpose
Ability to cancel in-flight worker executions (change workflow runs) via MCP tool, with proper abort propagation, status tracking, permission checks, and user-facing feedback across Slack surfaces.

## Requirements

### Requirement: cancel_worker_run MCP Tool

The system SHALL provide a `cancel_worker_run` MCP tool in query mode that aborts in-flight worker executions.

#### Scenario: Cancel own active worker run

- **WHEN** a dev+ user calls `cancel_worker_run` without `target_user_id`
- **THEN** the tool looks up the caller's active change via `getActiveChangeForUser(ctx.userId)`
- **AND** if an active run exists with a live `AbortController`, calls `abort()` on it
- **AND** sets `cancelledBy = { userId: ctx.userId, reason }` on the active change
- **AND** returns `{ ok: true, cancelled: true, sessionId, description }` immediately (the worker execution winds down asynchronously)

#### Scenario: Cancel another user's worker run (admin/owner)

- **WHEN** an admin or owner calls `cancel_worker_run` with `target_user_id`
- **THEN** the tool looks up the target user's active change
- **AND** aborts it with `cancelledBy` set to the calling admin's user ID
- **AND** returns success with the target user's session details

#### Scenario: Cancel another user's worker run (non-admin)

- **WHEN** a dev user calls `cancel_worker_run` with `target_user_id` that is not their own
- **THEN** the tool returns an error: "Only admins and owners can cancel other users' worker runs"

#### Scenario: No active worker run found

- **WHEN** `cancel_worker_run` is called and no active run exists for the target user
- **THEN** the tool returns an error: "No active worker run found"

#### Scenario: Stale session without AbortController

- **WHEN** `cancel_worker_run` is called and the target user has an active change but no `AbortController` (e.g., after restart)
- **THEN** the tool returns `{ ok: false, stale: true }` with an error message indicating no running worker process was found
- **AND** the response indicates the session may have been lost after a restart

#### Scenario: Tool registration

- **WHEN** the tool server is built in query mode
- **AND** the user has dev+ role and changes workflow is enabled
- **THEN** `cancel_worker_run` is registered alongside `propose_change` and `request_update`

### Requirement: Worker Execution AbortController Pipeline

The system SHALL thread an `AbortController` through the worker execution pipeline so it can be triggered externally.

#### Scenario: AbortController created per execution in startChangeWorkflow

- **WHEN** `startChangeWorkflow` enters the execution phase
- **THEN** a new `AbortController` is created and stored on `activeChange.abortController`
- **AND** the controller is passed through `executeChange` → `runClaudeInWorktree` → `runClaude`
- **AND** the controller is cleared (`undefined`) in a `finally` block after execution completes

#### Scenario: AbortController created per execution in handleFollowUp

- **WHEN** `handleFollowUp` processes any command (review, update, merge, close)
- **THEN** a new `AbortController` is created and stored on `activeChange.abortController`
- **AND** the controller is passed to the `runClaudeInWorktree` or `executeChange` call
- **AND** the controller is cleared in a `finally` block after the command completes

#### Scenario: runClaude accepts external AbortController

- **WHEN** `runClaude` is called with an `abortController` option
- **THEN** it uses the provided controller instead of creating one internally
- **AND** the timeout is still applied to the provided controller

#### Scenario: runClaude distinguishes cancellation from timeout

- **WHEN** the `AbortController` is aborted during execution
- **AND** the abort was user-initiated (not from the timeout callback)
- **THEN** `runClaude` returns `{ success: false, error: "Execution cancelled" }`
- **AND** the execution log records "Cancelled: Execution was cancelled by user"

#### Scenario: runClaude distinguishes timeout from cancellation

- **WHEN** the `AbortController` is aborted during execution
- **AND** the abort was from the timeout callback
- **THEN** `runClaude` returns the existing timeout error message
- **AND** the execution log records the timeout as before

### Requirement: Cancellation Display

The system SHALL display cancellation distinctly from failure in all user-facing surfaces.

#### Scenario: Streamer finalization on cancellation

- **WHEN** a worker execution is cancelled
- **AND** `ChangeResult` has `cancelled: true` and `cancelledBy` info
- **THEN** the streamer finalizes with "This work session was cancelled by <@userId>" appended below any partial progress (tool cards are force-completed, progress is preserved)
- **AND** if a reason was provided, appends it: "This work session was cancelled by <@userId>: reason"

#### Scenario: Home Tab display

- **WHEN** a change has status `"cancelled"`
- **THEN** the Home Tab shows a distinct emoji (`:no_entry_sign:`) and label "Cancelled"

#### Scenario: find_changes tool

- **WHEN** `find_changes` is called with `status: "cancelled"`
- **THEN** it returns changes that were cancelled
- **AND** the status enum accepts `"cancelled"` as a valid filter value
