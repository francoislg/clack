## MODIFIED Requirements

### Requirement: Change Request Feedback

The system SHALL provide feedback throughout the change request lifecycle.

#### Scenario: Acknowledge change request
- **WHEN** a change action is approved by the user (button click) or auto-executed
- **THEN** the system immediately replies with a status message
- **AND** resolves the staged intent to get branch, description, and repo
- **AND** starts the change workflow

#### Scenario: Initial progress message
- **WHEN** the change workflow starts (before Claude begins executing)
- **THEN** the orchestrator posts one initial status message to the thread (e.g., "Setting up workspace...")
- **AND** after Claude starts, Claude owns all further communication via the `report_status` tool

#### Scenario: Success determined from session state
- **GIVEN** Claude has finished executing
- **WHEN** the orchestrator reads the session state
- **AND** the session has a `prUrl` and status `pr_created`
- **THEN** the workflow returns success with the PR URL

#### Scenario: Failure determined from session state
- **GIVEN** Claude has finished executing
- **WHEN** the orchestrator reads the session state
- **AND** the session does NOT have a `prUrl`
- **THEN** the workflow returns failure
- **AND** the worktree is preserved for recovery

### Requirement: Thread Follow-up Commands

The system SHALL support follow-up commands in change threads via MCP tools.

#### Scenario: Detect follow-up via tools
- **GIVEN** a Slack thread has an active change session (PR created)
- **WHEN** a user replies in that thread
- **THEN** the tool server includes `request_review`, `request_merge`, `request_update`, `request_close` tools
- **AND** Claude calls the appropriate tool based on user intent
- **AND** Claude includes the corresponding action in `submit_response` for user approval

#### Scenario: Review command execution
- **GIVEN** a review action is approved
- **WHEN** the orchestrator starts the review flow
- **THEN** it fetches PR comments and reviews via the GitHub API
- **AND** builds a review prompt with the fetched feedback
- **AND** runs Claude with `review` mode tools (`git_push`, `report_status`)
- **AND** Claude implements review feedback, commits, and pushes via `git_push` tool
- **AND** Claude reports results via `report_status` tool

#### Scenario: Merge command execution
- **GIVEN** a merge action is approved
- **WHEN** the orchestrator starts the merge flow
- **THEN** it runs Claude with `merge` mode tools (`merge_pr`, `report_status`)
- **AND** Claude calls `merge_pr` which handles the merge, branch cleanup, and session cleanup
- **AND** Claude reports the result via `report_status`

#### Scenario: Update command execution
- **GIVEN** an update action is approved
- **WHEN** the orchestrator starts the update flow
- **THEN** it runs Claude with `update` mode tools (`git_push`, `report_status`) plus standard code tools
- **AND** Claude implements the requested changes, commits, and pushes via `git_push`
- **AND** Claude reports results via `report_status`

#### Scenario: Close command execution
- **GIVEN** a close action is approved
- **WHEN** the orchestrator starts the close flow
- **THEN** it runs Claude with `close` mode tools (`close_pr`, `report_status`)
- **AND** Claude calls `close_pr` which handles closing, optional branch deletion, and session cleanup
- **AND** Claude reports the result via `report_status`

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

## REMOVED Requirements

### Requirement: Worker Visibility — Real-time Slack progress updates
**Reason**: Replaced by `report_status` MCP tool. Claude now controls when and what progress messages are sent to the Slack thread, rather than the orchestrator sending generic progress via `onProgress` callbacks on a 30-second timer.
**Migration**: Remove `onProgress` callback plumbing from `executeChange()` and `handleFollowUp()`. The `report_status` tool handles all worker-to-Slack communication.
