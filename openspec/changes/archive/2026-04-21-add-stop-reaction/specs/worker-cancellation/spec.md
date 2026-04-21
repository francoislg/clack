## ADDED Requirements

### Requirement: Abort Worker via Stop Reaction

The system SHALL support cancelling in-flight worker-mode executions via the configured stop reaction (`config.reactions.stop`). The post-abort status and cleanup behavior depend on the worker's current lifecycle state. The operation SHALL be non-destructive to git, the worktree, and any associated PR.

#### Scenario: Abort during planning or executing

- **WHEN** a user adds the stop reaction to any message in a thread whose active change has status `planning` or `executing`
- **THEN** the system looks up `activeChange.abortController` for the session at `(channelId, threadTs)`
- **AND** sets `activeChange.cancelledBy = { userId: <reactor>, reason: "stopped via reaction" }`
- **AND** calls `abort()` on the controller
- **AND** the workflow transitions the change to status `cancelled` per the existing cancellation-display path
- **AND** the worktree is NOT removed
- **AND** any pushed branch on the remote is NOT deleted

#### Scenario: Abort during reviewing or merging

- **WHEN** a user adds the stop reaction to any message in a thread whose active change has status `reviewing` or `merging`
- **THEN** the system sets `activeChange.cancelledBy` with the reactor's user ID and reason
- **AND** calls `abort()` on `activeChange.abortController`
- **AND** the workflow reverts `activeChange.status` to `pr_created`
- **AND** the PR on GitHub is NOT closed
- **AND** the monitor continues watching the PR for external state changes

#### Scenario: Stop reaction on idle pr_created state

- **WHEN** a user adds the stop reaction to a thread whose active change has status `pr_created` with no in-flight follow-up
- **THEN** no abort occurs (nothing to abort)
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
- **THEN** the worker-side abort is a no-op (nothing to look up)
- **AND** the query-side abort sweep and disengagement still proceed

#### Scenario: Cancellation display on reaction-triggered abort

- **WHEN** a worker execution is aborted via the stop reaction and `cancelledBy` is set
- **THEN** the streamer finalizes with "This work session was cancelled by <@userId>: stopped via reaction" appended below any partial progress
- **AND** this uses the existing cancellation-display path (no new display code)

### Requirement: Worker-Mode Abort via Inline Stop Emoji

The system SHALL abort any in-flight worker-mode execution for a thread when a message in that thread matches the inline stop-emoji detection rule (defined in `slack-message-trigger`), with the same lifecycle-aware semantics as abort via stop reaction. The operation SHALL be non-destructive to git, the worktree, and any associated PR.

#### Scenario: Inline stop emoji during planning or executing state

- **WHEN** a message matching the inline stop-emoji detection rule arrives in a thread
- **AND** a worker-mode change for that thread is in `planning` or `executing` state
- **THEN** the system sets `activeChange.cancelledBy = { userId: <sender>, reason: "stopped via inline emoji" }`
- **AND** calls `abort()` on `activeChange.abortController`
- **AND** the workflow transitions the change to status `cancelled`
- **AND** leaves the worktree and any pushed branch intact
- **AND** does NOT close the PR or perform any destructive git operation

#### Scenario: Inline stop emoji during reviewing or merging state

- **WHEN** a message matching the inline stop-emoji detection rule arrives in a thread
- **AND** a worker-mode change for that thread is in `reviewing` or `merging` state
- **THEN** the system sets `activeChange.cancelledBy` with the sender's user ID and inline reason
- **AND** calls `abort()` on `activeChange.abortController`
- **AND** the workflow reverts `activeChange.status` to `pr_created`
- **AND** the PR on GitHub is NOT closed
- **AND** the monitor continues watching the PR for external state changes

#### Scenario: Inline stop emoji during idle pr_created state

- **WHEN** a message matching the inline stop-emoji detection rule arrives in a thread
- **AND** a worker-mode change for that thread is in `pr_created` state with no in-flight follow-up
- **THEN** no worker abort occurs (nothing to abort)
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
- **AND** the streamer finalization text differs only in the `reason` field ("stopped via reaction" vs "stopped via inline emoji")

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
