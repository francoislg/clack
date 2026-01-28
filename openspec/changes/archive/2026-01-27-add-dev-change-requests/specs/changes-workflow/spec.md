## ADDED Requirements

### Requirement: Changes Workflow Configuration

The system SHALL support a top-level configuration section for the change request workflow.

#### Scenario: Top-level workflow configuration
- **WHEN** `changesWorkflow` is configured at the root config level
- **THEN** it defines the global workflow behavior
- **AND** includes: `enabled`, `prInstructions`, `timeoutMinutes`, `maxConcurrent`, `additionalAllowedTools`

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

#### Scenario: PR instructions in config
- **WHEN** `changesWorkflow.prInstructions` is configured
- **THEN** the instructions are included in Claude's prompt for PR creation
- **AND** Claude follows them when writing commit messages and PR descriptions

#### Scenario: Execution timeout configuration
- **WHEN** `changesWorkflow.timeoutMinutes` is configured
- **THEN** the system uses that value as the maximum execution time
- **AND** defaults to 10 minutes if not specified

#### Scenario: Concurrent execution limit
- **WHEN** `changesWorkflow.maxConcurrent` is configured
- **THEN** the system limits active change executions to that number
- **AND** queues additional requests with a "please wait" message
- **AND** defaults to 3 if not specified

#### Scenario: Additional allowed tools
- **WHEN** `changesWorkflow.additionalAllowedTools` is configured as an array
- **THEN** those tools are added to the default allowed tools for change execution
- **AND** allows enabling tools like `WebFetch`, `WebSearch` for changes

### Requirement: Change Request Detection

The system SHALL use Claude's semantic understanding to detect change requests.

#### Scenario: Claude-driven detection for DM
- **GIVEN** `changesWorkflow.enabled` is `true` AND `directMessages.changesWorkflow.enabled` is `true`
- **AND** the user has dev role
- **WHEN** a user sends a new DM (not a thread reply)
- **THEN** the system adds change detection instructions to Claude's prompt
- **AND** Claude analyzes message intent semantically

#### Scenario: Claude-driven detection for mention
- **GIVEN** `changesWorkflow.enabled` is `true` AND `mentions.changesWorkflow.enabled` is `true`
- **AND** the user has dev role
- **WHEN** a user mentions the bot
- **THEN** the system adds change detection instructions to Claude's prompt
- **AND** Claude analyzes message intent semantically

#### Scenario: Explicit change request via reaction
- **GIVEN** `changesWorkflow.enabled` is `true` AND `reactions.changesWorkflow.enabled` is `true`
- **WHEN** a user reacts with the `reactions.changesWorkflow.trigger` emoji
- **THEN** the system treats the reacted message as a change request
- **AND** proceeds with role verification and execution

#### Scenario: Claude identifies change request
- **GIVEN** change detection is enabled for the trigger type
- **WHEN** Claude determines the message is requesting code changes
- **THEN** Claude returns `<change-request>` tags with branch, description, and target repo
- **AND** the system routes to the change workflow

#### Scenario: Claude identifies question
- **GIVEN** change detection is enabled for the trigger type
- **WHEN** Claude determines the message is asking a question (not requesting changes)
- **THEN** Claude returns `<answer>` tags with the response
- **AND** the system displays the answer normally (Q&A flow)

#### Scenario: Semantic disambiguation
- **GIVEN** a message like "how do I fix this?" vs "fix the login bug"
- **WHEN** Claude analyzes the intent
- **THEN** questions about fixing are treated as Q&A
- **AND** explicit fix requests are treated as change requests
- **AND** Claude defaults to Q&A when uncertain

### Requirement: Change Request Feedback

The system SHALL provide feedback throughout the change request lifecycle.

#### Scenario: Acknowledge change request
- **WHEN** a change request is detected and authorized
- **THEN** the system immediately replies with a status message
- **AND** the message indicates the request is being processed

#### Scenario: Progress update during execution
- **WHEN** Claude is executing a change
- **THEN** the system sends periodic updates (every 30 seconds)
- **AND** updates include current status and Claude's last activity

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

### Requirement: Change Request State Management

The system SHALL track active change requests to prevent conflicts.

#### Scenario: Track active changes per user
- **WHEN** a change request starts execution
- **THEN** the system records: user ID, repository, branch, start time, PR URL, thread ID
- **AND** the record is removed when the PR is merged or closed

#### Scenario: Prevent duplicate requests
- **GIVEN** a user has an active change request
- **WHEN** they send another change request (outside the existing thread)
- **THEN** the system responds that they have a pending request
- **AND** provides a link to the existing thread

#### Scenario: System-wide concurrency limit
- **GIVEN** the system has reached `maxConcurrent` active changes
- **WHEN** a new change request arrives
- **THEN** the system responds that capacity is reached
- **AND** suggests trying again later

### Requirement: Thread Follow-up Commands

The system SHALL support follow-up commands in the Slack thread after PR creation.

#### Scenario: Detect follow-up in change thread
- **GIVEN** a Slack thread has an active change session (PR created)
- **WHEN** a user replies in that thread
- **THEN** Claude analyzes the message to detect follow-up command intent
- **AND** Claude returns `<follow-up-command>` tags with command type and instructions
- **AND** routes to the appropriate handler (review, merge, update, close)
- **OR** treats as a question if no command is detected

#### Scenario: Review command
- **GIVEN** an active change thread with a PR
- **WHEN** user sends "review", "check comments", or "address feedback"
- **THEN** the system fetches PR comments and review feedback
- **AND** Claude implements requested changes
- **AND** pushes updates to the PR

#### Scenario: Merge command
- **GIVEN** an active change thread with a PR
- **WHEN** user sends "merge", "merge it", or "ship it"
- **THEN** the system attempts to merge the PR
- **AND** Claude decides whether to delete the remote branch
- **AND** Claude cleans up the worktree if appropriate
- **AND** reports success or failure in the thread with cleanup summary

#### Scenario: Update command
- **GIVEN** an active change thread with a PR
- **WHEN** user sends additional instructions like "also fix X" or "add Y"
- **THEN** Claude implements the additional changes in the worktree
- **AND** commits and pushes to update the PR

#### Scenario: Close command
- **GIVEN** an active change thread with a PR
- **WHEN** user sends "close", "abandon", or "cancel"
- **THEN** the system closes the PR without merging
- **AND** Claude asks the user if the branch should be deleted or kept for later
- **AND** Claude cleans up the worktree based on user preference
- **AND** confirms closure in the thread with cleanup summary

#### Scenario: Thread session expiry
- **GIVEN** a change thread has been idle for the configured period (default 24h)
- **WHEN** the session expires
- **THEN** the worktree is cleaned up
- **AND** new messages in the thread are treated as new requests (if Claude detects a change request)

### Requirement: Worker Visibility

The system SHALL provide real-time visibility into change execution progress.

#### Scenario: Session state persistence
- **WHEN** a change session is created
- **THEN** the system creates `data/worktree-sessions/{branch-name}/state.json`
- **AND** the state includes: sessionId, status, phase, branch, repo, userId, description, prUrl, startedAt, lastActivityAt, lastMessage

#### Scenario: State updates during execution
- **WHEN** the session status changes (planning → executing → pr_created → etc.)
- **THEN** the system updates `state.json` with new status and phase
- **AND** updates `lastActivityAt` timestamp

#### Scenario: Execution logging
- **WHEN** Claude produces output during change execution
- **THEN** the system appends to `data/worktree-sessions/{branch-name}/execution.log`
- **AND** each log entry includes a timestamp in ISO format

#### Scenario: Real-time Slack progress updates
- **GIVEN** a change execution is in progress
- **WHEN** 30 seconds have elapsed since the last update
- **THEN** the system updates the Slack message with Claude's current activity
- **AND** the format is "Implementing changes...\n_Currently: {activity}_"
- **AND** long activity messages are truncated to fit Slack limits

#### Scenario: Session folder cleanup on success
- **GIVEN** a change session completes successfully (merged or closed)
- **WHEN** the session is removed
- **THEN** the session folder is deleted from `data/worktree-sessions/`

#### Scenario: Session folder preserved on failure
- **GIVEN** a change session fails
- **WHEN** cleanup runs
- **THEN** the session folder is NOT deleted
- **AND** the folder is preserved indefinitely for debugging
- **AND** manual deletion is required to remove it

#### Scenario: Active workers display
- **GIVEN** a user with dev role views the Home tab
- **WHEN** there are active change sessions
- **THEN** the Home tab shows a "Active Workers" section
- **AND** each worker shows: status, description, branch, repo, user, and PR link (if available)
