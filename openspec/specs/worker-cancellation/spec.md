# worker-cancellation Specification

## Purpose
Ability to cancel in-flight worker executions (change workflow runs) via MCP tool, with proper abort propagation, status tracking, permission checks, and user-facing feedback across Slack surfaces.

## Requirements

### Requirement: cancel_worker_run MCP Tool

The system SHALL provide a `cancel_worker_run` MCP tool in query mode that aborts in-flight worker executions via the worker's `ClaudeRunHandle`.

#### Scenario: Cancel own active worker run

- **WHEN** a dev+ user calls `cancel_worker_run` without `target_user_id`
- **THEN** the tool looks up the caller's active change via `getActiveChangeForUser(ctx.userId)`
- **AND** if an active run exists with a live `ClaudeRunHandle`, calls `handle.stop(reason)` on it
- **AND** sets `cancelledBy = { userId: ctx.userId, reason }` on the active change
- **AND** returns `{ ok: true, cancelled: true, sessionId, description }` immediately (the worker execution winds down asynchronously)

#### Scenario: Cancel another user's worker run (admin/owner)

- **WHEN** an admin or owner calls `cancel_worker_run` with `target_user_id`
- **THEN** the tool looks up the target user's active change
- **AND** stops it via `handle.stop(reason)` with `cancelledBy` set to the calling admin's user ID
- **AND** returns success with the target user's session details

#### Scenario: Cancel another user's worker run (non-admin)

- **WHEN** a dev user calls `cancel_worker_run` with `target_user_id` that is not their own
- **THEN** the tool returns an error: "Only admins and owners can cancel other users' worker runs"

#### Scenario: No active worker run found

- **WHEN** `cancel_worker_run` is called and no active run exists for the target user
- **THEN** the tool returns an error: "No active worker run found"

#### Scenario: Stale session without handle

- **WHEN** `cancel_worker_run` is called and the target user has an active change but no `ClaudeRunHandle` (e.g., after restart)
- **THEN** the tool returns `{ ok: false, stale: true }` with an error message indicating no running worker process was found
- **AND** the response indicates the session may have been lost after a restart

#### Scenario: Tool registration

- **WHEN** the tool server is built in query mode
- **AND** the user has dev+ role and changes workflow is enabled
- **THEN** `cancel_worker_run` is registered alongside `propose_change` and `request_update`

### Requirement: Worker Execution Handle Pipeline

The system SHALL store the worker's `ClaudeRunHandle` on the active change record so it can be triggered externally via `handle.stop(...)`. The handle replaces the prior `activeChange.abortController` field.

#### Scenario: Handle stored per execution in startChangeWorkflow

- **WHEN** `startChangeWorkflow` enters the execution phase
- **THEN** `executeChange` returns a `ClaudeRunHandle`
- **AND** the workflow stores it on `activeChange.handle`
- **AND** the handle's slot is released (cleared) in a `finally` block after execution completes

#### Scenario: Handle stored per execution in handleFollowUp

- **WHEN** `handleFollowUp` processes any command (review, update, merge, close)
- **THEN** the resulting `ClaudeRunHandle` is stored on `activeChange.handle`
- **AND** the handle is cleared in a `finally` block after the command completes

#### Scenario: executeChange exposes a handle

- **WHEN** `executeChange` is called
- **THEN** it returns a `ClaudeRunHandle` instead of a `Promise<ExecutionResult>`
- **AND** the caller awaits `handle.futureResponse` (mapped/wrapped into `ExecutionResult`) where it used to await `executeChange` directly
- **AND** the caller may call `handle.sendUpdate(text)` while the worker is running to inject context

#### Scenario: Worker distinguishes cancellation from timeout

- **WHEN** the worker run is stopped via `handle.stop(reason)` and `reason` indicates user cancellation
- **THEN** `executeChange`'s mapped result returns `{ success: false, error: "Execution cancelled" }`
- **AND** the execution log records "Cancelled: Execution was cancelled by user"

#### Scenario: Worker distinguishes timeout from cancellation

- **WHEN** the worker run is stopped because the timeout callback aborted the underlying controller
- **THEN** `executeChange`'s mapped result returns the existing timeout error message
- **AND** the execution log records the timeout as before

### Requirement: Worker Mid-Run Context Injection

The system SHALL allow follow-up messages in a change thread to be delivered to the running worker as queued user input via `handle.sendUpdate(text)`, when the worker run is still in `"running"` state.

#### Scenario: Follow-up message in change thread routes to sendUpdate

- **WHEN** a user posts a message in a thread whose active change has a registered `ClaudeRunHandle` in `"running"` status
- **THEN** the Slack handler that processes the message consults the active-runs registry and finds the handle
- **AND** calls `handle.sendUpdate(text)` instead of constructing a fresh worker run
- **AND** the worker receives the message as the next user input on its input stream
- **AND** the model sees the message after its current turn (or current tool call sequence) finishes

#### Scenario: sendUpdate rejects when run already settled

- **WHEN** the handler invokes `handle.sendUpdate(text)` and the call rejects (e.g., the worker just emitted its first `result`)
- **THEN** the handler falls back to the existing fresh-spawn path
- **AND** the new message becomes the prompt of a new run that resumes from the persisted `sdkSessionId`

#### Scenario: Worker observes follow-up on next turn boundary

- **WHEN** `handle.sendUpdate(text)` is called while the worker is mid-tool-call
- **THEN** the SDK queues the user message and the model receives it after the in-flight tool call's results are returned to the model
- **AND** no tool call is interrupted (this is non-interrupting `sendUpdate`, not `interrupt()`)

### Requirement: Cancellation Display

The system SHALL display cancellation distinctly from failure in all user-facing surfaces.

#### Scenario: Streamer finalization on cancellation

- **WHEN** a worker execution is stopped via `handle.stop(...)`
- **AND** `ChangeResult` has `cancelled: true` and `cancelledBy` info (derived from the handle's stop reason and the active change's `cancelledBy` field)
- **THEN** the streamer finalizes with "This work session was cancelled by <@userId>" appended below any partial progress (tool cards are force-completed, progress is preserved)
- **AND** if a reason was provided, appends it: "This work session was cancelled by <@userId>: reason"

#### Scenario: Home Tab display

- **WHEN** a change has status `"cancelled"`
- **THEN** the Home Tab shows a distinct emoji (`:no_entry_sign:`) and label "Cancelled"

#### Scenario: find_changes tool

- **WHEN** `find_changes` is called with `status: "cancelled"`
- **THEN** it returns changes that were cancelled
- **AND** the status enum accepts `"cancelled"` as a valid filter value

#### Scenario: Cancellation display on reaction-triggered abort

- **WHEN** a worker execution is aborted via the stop reaction and `cancelledBy` is set
- **THEN** the streamer finalizes with "This work session was cancelled by <@userId>: stopped via reaction" appended below any partial progress
- **AND** this uses the existing cancellation-display path (no new display code)

### Requirement: Abort Worker via Stop Reaction

The system SHALL support cancelling in-flight worker-mode executions via the configured stop reaction (`config.reactions.stop`). Cancellation routes through `handle.stop(...)` on the worker's `ClaudeRunHandle`. The post-abort status and cleanup behavior depend on the worker's current lifecycle state. The operation SHALL be non-destructive to git, the worktree, and any associated PR.

#### Scenario: Abort during planning or executing

- **WHEN** a user adds the stop reaction to any message in a thread whose active change has status `planning` or `executing`
- **THEN** the system looks up `activeChange.handle` for the session at `(channelId, threadTs)`
- **AND** sets `activeChange.cancelledBy = { userId: <reactor>, reason: "stopped via reaction" }`
- **AND** calls `handle.stop("stopped via reaction")` on the handle
- **AND** the workflow transitions the change to status `cancelled` per the existing cancellation-display path
- **AND** the worktree is NOT removed
- **AND** any pushed branch on the remote is NOT deleted

#### Scenario: Abort during reviewing or merging

- **WHEN** a user adds the stop reaction to any message in a thread whose active change has status `reviewing` or `merging`
- **THEN** the system sets `activeChange.cancelledBy` with the reactor's user ID and reason
- **AND** calls `handle.stop(...)` on `activeChange.handle`
- **AND** the workflow reverts `activeChange.status` to `pr_created`
- **AND** the PR on GitHub is NOT closed
- **AND** the monitor continues watching the PR for external state changes

#### Scenario: Stop reaction on idle pr_created state

- **WHEN** a user adds the stop reaction to a thread whose active change has status `pr_created` with no in-flight follow-up
- **THEN** no abort occurs (no handle is registered for the thread)
- **AND** the change's status remains `pr_created`
- **AND** the PR, worktree, and monitor are unchanged
- **AND** thread disengagement still proceeds (per auto-respond-tracking spec)

#### Scenario: Stop reaction on terminal status

- **WHEN** a user adds the stop reaction to a thread whose active change has status `completed`, `failed`, or `cancelled`
- **THEN** the status is left unchanged (idempotent)
- **AND** `cancelledBy` is NOT overwritten if already set
- **AND** thread disengagement still proceeds

#### Scenario: Stop reaction when no active change exists

- **WHEN** a user adds the stop reaction to a thread that has no active change
- **THEN** the worker-side abort is a no-op (no handle to look up)
- **AND** the query-side abort sweep and disengagement still proceed

### Requirement: Worker-Mode Abort via Inline Stop Emoji

The system SHALL abort any in-flight worker-mode execution for a thread when a message in that thread matches the inline stop-emoji detection rule (defined in `slack-message-trigger`), routing through `handle.stop(...)` on the worker's `ClaudeRunHandle`. The lifecycle-aware semantics match abort via stop reaction. The operation SHALL be non-destructive to git, the worktree, and any associated PR.

#### Scenario: Inline stop emoji during planning or executing state

- **WHEN** a message matching the inline stop-emoji detection rule arrives in a thread
- **AND** a worker-mode change for that thread is in `planning` or `executing` state
- **THEN** the system sets `activeChange.cancelledBy = { userId: <sender>, reason: "stopped via inline emoji" }`
- **AND** calls `handle.stop("stopped via inline emoji")` on `activeChange.handle`
- **AND** the workflow transitions the change to status `cancelled`
- **AND** leaves the worktree and any pushed branch intact
- **AND** does NOT close the PR or perform any destructive git operation

#### Scenario: Inline stop emoji during reviewing or merging state

- **WHEN** a message matching the inline stop-emoji detection rule arrives in a thread
- **AND** a worker-mode change for that thread is in `reviewing` or `merging` state
- **THEN** the system sets `activeChange.cancelledBy` with the sender's user ID and inline reason
- **AND** calls `handle.stop(...)` on `activeChange.handle`
- **AND** the workflow reverts `activeChange.status` to `pr_created`
- **AND** the PR on GitHub is NOT closed
- **AND** the monitor continues watching the PR for external state changes

#### Scenario: Inline stop emoji during idle pr_created state

- **WHEN** a message matching the inline stop-emoji detection rule arrives in a thread
- **AND** a worker-mode change for that thread is in `pr_created` state with no in-flight follow-up
- **THEN** no worker abort occurs (no handle is registered)
- **AND** the change's status remains `pr_created`
- **AND** the PR, worktree, and monitor are unchanged
- **AND** thread disengagement still proceeds (per auto-respond-tracking spec)

#### Scenario: Inline stop emoji during terminal worker states

- **WHEN** a message matching the inline stop-emoji detection rule arrives in a thread
- **AND** the worker-mode change for that thread is in a terminal state (`completed`, `failed`, or `cancelled`)
- **THEN** the worker-side action is idempotent (no status change, `cancelledBy` not overwritten)
- **AND** thread disengagement still proceeds

#### Scenario: Inline stop emoji with no active change

- **WHEN** a message matching the inline stop-emoji detection rule arrives in a thread with no active change
- **THEN** the worker-side action is a no-op
- **AND** the query-side abort sweep and disengagement still proceed

#### Scenario: Inline and reaction produce identical end state

- **WHEN** either the stop reaction is added OR an inline-matching message arrives
- **AND** the target thread has a worker change in the same lifecycle state
- **THEN** both paths produce identical post-stop status, worktree state, PR state, and `cancelledBy` assignment
- **AND** the streamer finalization text differs only in the `reason` field passed to `handle.stop(...)`

### Requirement: Re-Engagement via Change-Thread Button Click

The system SHALL re-engage a disengaged thread when a user clicks any change-thread action button (Merge, Review, Close, Accept, Edit, or other follow-up buttons) on a change whose thread has `autoResponseActive === false`.

#### Scenario: Button click on disengaged thread re-engages

- **WHEN** a user clicks any change-thread action button (Merge, Review, Close, Accept, Edit, etc.)
- **AND** the session for the thread has `autoResponseActive === false`
- **THEN** the handler sets `autoResponseActive = true` on the session before processing the action
- **AND** persists the updated session to disk
- **AND** proceeds to handle the action as normal

#### Scenario: Button click on engaged thread is unchanged

- **WHEN** a user clicks any change-thread action button
- **AND** the session for the thread has `autoResponseActive === true` or no session exists
- **THEN** the handler proceeds without any re-engagement step
- **AND** behavior is unchanged from prior (no additional persistence)

#### Scenario: Buttons remain visible and live after stop

- **WHEN** a thread has been stopped via the stop reaction
- **AND** the change thread has action buttons (Merge, Review, Close, etc.)
- **THEN** the buttons remain visible and clickable
- **AND** clicking them triggers re-engagement followed by normal action processing
