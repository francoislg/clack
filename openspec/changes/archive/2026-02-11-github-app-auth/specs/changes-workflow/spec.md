## MODIFIED Requirements

### Requirement: Changes Workflow Configuration

The system SHALL support a top-level configuration section for the change request workflow.

#### Scenario: Top-level workflow configuration
- **WHEN** `changesWorkflow` is configured at the root config level
- **THEN** it defines the global workflow behavior
- **AND** includes: `enabled`, `prInstructions`, `timeoutMinutes`, `maxConcurrent`, `additionalAllowedTools`, `sessionExpiryHours`, `monitoringIntervalMinutes`

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

#### Scenario: Session expiry configuration
- **WHEN** `changesWorkflow.sessionExpiryHours` is configured
- **THEN** idle sessions are cleaned up after that period
- **AND** defaults to 24 hours if not specified

#### Scenario: Monitoring interval configuration
- **WHEN** `changesWorkflow.monitoringIntervalMinutes` is configured
- **THEN** the completion monitor runs at that interval
- **AND** defaults to 15 minutes if not specified
- **AND** set to 0 to disable monitoring

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
- **THEN** the system fetches PR comments and review feedback via the GitHub API (Octokit)
- **AND** Claude implements requested changes
- **AND** pushes updates to the PR

#### Scenario: Merge command
- **GIVEN** an active change thread with a PR
- **WHEN** user sends "merge", "merge it", or "ship it"
- **THEN** the system merges the PR via the GitHub API (Octokit)
- **AND** uses the configured merge strategy (squash, merge, or rebase)
- **AND** optionally deletes the remote branch after merge
- **AND** cleans up the worktree
- **AND** reports success or failure in the thread with cleanup summary

#### Scenario: Update command
- **GIVEN** an active change thread with a PR
- **WHEN** user sends additional instructions like "also fix X" or "add Y"
- **THEN** Claude implements the additional changes in the worktree
- **AND** commits and pushes to update the PR

#### Scenario: Close command
- **GIVEN** an active change thread with a PR
- **WHEN** user sends "close", "abandon", or "cancel"
- **THEN** the system closes the PR without merging via the GitHub API (Octokit)
- **AND** Claude asks the user if the branch should be deleted or kept for later
- **AND** Claude cleans up the worktree based on user preference
- **AND** confirms closure in the thread with cleanup summary

#### Scenario: Thread session expiry
- **GIVEN** a change thread has been idle for the configured period (default 24h)
- **WHEN** the session expires
- **THEN** the worktree is cleaned up
- **AND** new messages in the thread are treated as new requests (if Claude detects a change request)

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

### Requirement: PR Operations via GitHub API

The system SHALL perform all PR operations through the GitHub API using Octokit.

#### Scenario: Create PR via API
- **GIVEN** changes have been committed and pushed to a branch
- **WHEN** a PR needs to be created
- **THEN** the system uses Octokit to create the PR (`POST /repos/{owner}/{repo}/pulls`)
- **AND** sets the title, body, base branch, and head branch
- **AND** returns the PR URL on success

#### Scenario: Merge PR via API
- **GIVEN** a PR is open and ready to merge
- **WHEN** a merge is requested
- **THEN** the system uses Octokit to merge the PR (`PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge`)
- **AND** uses the configured merge strategy (squash, merge, or rebase)

#### Scenario: Close PR via API
- **GIVEN** a PR is open
- **WHEN** a close is requested
- **THEN** the system uses Octokit to close the PR (`PATCH /repos/{owner}/{repo}/pulls/{pull_number}`)
- **AND** sets the state to `closed`

#### Scenario: Get PR status via API
- **GIVEN** a PR URL exists in the session
- **WHEN** the system checks PR status
- **THEN** it uses Octokit to fetch the PR state (`GET /repos/{owner}/{repo}/pulls/{pull_number}`)
- **AND** returns `OPEN`, `MERGED`, or `CLOSED`

#### Scenario: Fetch PR review comments via API
- **GIVEN** a review command is triggered
- **WHEN** the system fetches PR feedback
- **THEN** it uses Octokit to get comments and reviews
- **AND** passes the feedback to Claude for implementation

#### Scenario: Delete remote branch via API
- **GIVEN** a PR has been merged or closed
- **WHEN** branch deletion is requested
- **THEN** the system uses Octokit to delete the branch (`DELETE /repos/{owner}/{repo}/git/refs/heads/{branch}`)

#### Scenario: Push via git with token authentication
- **GIVEN** changes need to be pushed to a remote branch
- **WHEN** a push operation is needed
- **THEN** the system configures the remote URL with a fresh installation token
- **AND** uses `simple-git` to push over HTTPS
