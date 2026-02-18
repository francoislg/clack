## MODIFIED Requirements

### Requirement: Change Request State Management

The system SHALL track active change requests to prevent conflicts.

#### Scenario: Track active changes per user
- **WHEN** a change request starts execution
- **THEN** the system records: user ID, repository, branch, start time, PR URL, thread ID
- **AND** the record is removed when the PR is merged or closed

#### Scenario: Prevent duplicate requests only during active execution
- **GIVEN** a user has a change session in an actively-executing state (`executing`, `reviewing`, `merging`)
- **WHEN** they send another change request (outside the existing thread)
- **THEN** the system responds that they have a pending request
- **AND** provides a link to the existing thread

#### Scenario: Allow new changes when existing session is idle
- **GIVEN** a user has a change session in `pr_created` state
- **WHEN** they send a new change request
- **THEN** the system allows the new change to proceed
- **AND** the existing `pr_created` session remains active for follow-up actions

#### Scenario: System-wide concurrency limit
- **GIVEN** the system has reached `maxConcurrent` active changes
- **WHEN** a new change request arrives
- **THEN** the system responds that capacity is reached
- **AND** suggests trying again later

### Requirement: Change Request Feedback

The system SHALL provide feedback throughout the change request lifecycle.

#### Scenario: Acknowledge change request
- **WHEN** a change action is approved by the user (button click) or auto-executed
- **THEN** the system immediately replies with a status message
- **AND** resolves the staged intent to get branch, description, and repo
- **AND** starts the change workflow

#### Scenario: Progress update during execution
- **WHEN** Claude is executing a change
- **THEN** the system sends periodic updates (every 30 seconds)
- **AND** updates the existing progress message in-place (using `chat.update`)
- **AND** updates include current status and Claude's last activity

#### Scenario: Progress update during follow-up execution
- **WHEN** Claude is executing a follow-up action (update, review)
- **THEN** the system posts one acknowledgment message in the thread
- **AND** updates that message in-place with periodic progress (every 30 seconds)
- **AND** does NOT post new messages for each progress update

#### Scenario: Success notification
- **GIVEN** change execution and PR creation succeeded
- **WHEN** the workflow completes
- **THEN** the system replies in the thread with:
  - PR URL
  - Brief summary of changes
  - Commit count

#### Scenario: Failure notification
- **GIVEN** change execution or PR creation failed
- **WHEN** the workflow fails
- **THEN** the system replies in the thread with:
  - Error message
  - Suggestion for what to try next
  - Note that the worktree is preserved for manual recovery (if applicable)
