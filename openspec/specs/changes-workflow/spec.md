# changes-workflow Specification

## Purpose
TBD - created by archiving change add-dev-change-requests. Update Purpose after archive.
## Requirements
### Requirement: Changes Workflow Configuration

The system SHALL support a top-level configuration section for the change request workflow.

#### Scenario: Top-level workflow configuration
- **WHEN** `changesWorkflow` is configured at the root config level
- **THEN** it defines the global workflow behavior
- **AND** includes: `enabled`, `timeoutMinutes`, `maxConcurrent`, `additionalAllowedTools`, `sessionExpiryHours`, `monitoringIntervalMinutes`

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

## REMOVED Requirements

### Requirement: PR instructions in config
**Reason**: Replaced by `{repo-name}/changes_instructions.md` convention-based files which follow the two-tier resolution chain and are editable via admin UI.
**Migration**: Move content from `pullRequestInstructions` (repo config field) or `changesWorkflow.prInstructions` (global config) into `data/default_configuration/{repo-name}_changes_instructions.md` or `data/configuration/{repo-name}_changes_instructions.md`.

### Requirement: Change Request Detection

The system SHALL detect change request intent via the `propose_change` MCP tool call.

#### Scenario: Claude-driven detection via tool
- **GIVEN** `changesWorkflow.enabled` is `true` AND the trigger's changes workflow is enabled
- **AND** the user has dev role (or higher)
- **WHEN** Claude determines the message is requesting code changes
- **THEN** Claude calls `propose_change` with branch, description, and repo
- **AND** the tool validates the input and returns a ref ID
- **AND** Claude includes a `change` action in `submit_response` referencing the ref

#### Scenario: Claude identifies question (no tool call)
- **GIVEN** change tools are available
- **WHEN** Claude determines the message is asking a question
- **THEN** Claude does NOT call `propose_change`
- **AND** Claude calls `submit_response` with an answer and standard Q&A actions

#### Scenario: Branch validation in tool
- **WHEN** Claude calls `propose_change` with a branch name
- **THEN** the tool validates the branch follows `clack/{type}/{name}` convention
- **AND** validates `type` is one of: fix, feat, refactor, docs, chore
- **AND** returns an error if validation fails, allowing Claude to retry

#### Scenario: Repository validation in tool
- **WHEN** Claude calls `propose_change` with a repo name
- **THEN** the tool validates the repo exists in configuration and supports changes
- **AND** returns an error with the list of available repos if validation fails

#### Scenario: Existing worktree detection
- **GIVEN** a worktree already exists for the specified branch and repo
- **WHEN** Claude calls `propose_change`
- **THEN** the tool returns success with the ref ID plus existing worktree metadata (status, last activity)
- **AND** Claude can present a `choice` to the user: resume the existing session or start fresh

#### Scenario: Explicit change request via reaction
- **GIVEN** `changesWorkflow.enabled` is `true` AND `reactions.changesWorkflow.enabled` is `true`
- **WHEN** a user reacts with the `reactions.changesWorkflow.trigger` emoji
- **THEN** the system treats the reacted message as a change request
- **AND** proceeds with role verification and the tool-based flow

### Requirement: Change Request Feedback

The system SHALL provide feedback throughout the change request lifecycle.

#### Scenario: Acknowledge change request
- **WHEN** a change action is approved by the user (button click)
- **THEN** the system immediately replies with a status message
- **AND** resolves the staged intent to get branch, description, and repo
- **AND** starts the change workflow

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

The system SHALL support follow-up commands in change threads via MCP tools.

#### Scenario: Detect follow-up via tools
- **GIVEN** a Slack thread has an active change session (PR created)
- **WHEN** a user replies in that thread
- **THEN** the tool server includes `request_review`, `request_merge`, `request_update`, `request_close` tools
- **AND** Claude calls the appropriate tool based on user intent
- **AND** Claude includes the corresponding action in `submit_response` for user approval

#### Scenario: Review command via tool
- **GIVEN** an active change thread with a PR
- **WHEN** Claude calls `request_review`
- **THEN** the tool validates the PR exists
- **AND** stages a review intent
- **AND** user approval triggers: fetch PR comments, run Claude to address feedback, push updates

#### Scenario: Merge command via tool
- **GIVEN** an active change thread with a PR
- **WHEN** Claude calls `request_merge`
- **THEN** the tool validates the PR exists and is open
- **AND** stages a merge intent
- **AND** user approval triggers: merge PR, cleanup worktree, report success

#### Scenario: Update command via tool
- **GIVEN** an active change thread with a PR
- **WHEN** Claude calls `request_update` with additional instructions
- **THEN** the tool validates the worktree exists
- **AND** stages an update intent with the instructions
- **AND** user approval triggers: run Claude with new instructions, push updates

#### Scenario: Close command via tool
- **GIVEN** an active change thread with a PR
- **WHEN** Claude calls `request_close`
- **THEN** the tool validates the PR exists and is open
- **AND** stages a close intent
- **AND** user approval triggers: close PR, optionally delete branch, cleanup worktree

#### Scenario: Follow-up as question
- **GIVEN** a change thread context
- **WHEN** Claude determines the message is a question (not a follow-up command)
- **THEN** Claude does NOT call any follow-up tools
- **AND** responds with a standard Q&A answer via `submit_response`

#### Scenario: Thread session expiry
- **GIVEN** a change thread has been idle for the configured period (default 24h)
- **WHEN** the session expires
- **THEN** the worktree is cleaned up
- **AND** new messages in the thread are treated as new requests

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

