## MODIFIED Requirements

### Requirement: Change Request State Management

The system SHALL track active change execution as runtime state on the unified thread session.

#### Scenario: Track active changes via unified session

- **WHEN** a change request starts execution
- **THEN** the system populates `activeChange` on the existing thread session with: branch, repo, description, worktree, status, start time
- **AND** the session's in-memory thread index already maps the thread to this session

#### Scenario: Prevent duplicate requests only during active execution

- **GIVEN** a user has a session with `activeChange` in an actively-executing state (`executing`, `reviewing`, `merging`)
- **WHEN** they send another change request (outside the existing thread)
- **THEN** the system responds that they have a pending request
- **AND** provides a link to the existing thread

#### Scenario: Allow new changes when existing session is idle

- **GIVEN** a user has a session with `activeChange` in `pr_created` state
- **WHEN** they send a new change request in a different thread
- **THEN** the system allows the new change to proceed
- **AND** the existing session's `activeChange` remains available for context

#### Scenario: System-wide concurrency limit

- **GIVEN** the system has reached `maxConcurrent` sessions with active change executions
- **WHEN** a new change request arrives
- **THEN** the system responds that capacity is reached
- **AND** suggests trying again later

### Requirement: Thread Follow-up Commands

The system SHALL support follow-up actions in threads via Claude's intent analysis, not via state-gated tool availability. Claude receives active change context (if any) as prompt context and decides what to do based on the user's message.

#### Scenario: Follow-up on active change via context

- **GIVEN** a thread's session has `activeChange` with a branch and optional PR URL
- **WHEN** a user replies in that thread
- **THEN** Claude receives the active change details as prompt context (branch, repo, status, PR URL)
- **AND** Claude determines the user's intent from the message content
- **AND** Claude uses the appropriate tools (Clack tools, GitHub MCP, or both) to fulfill the request

#### Scenario: Follow-up after change execution cleared

- **GIVEN** a thread previously had an active change that has since been cleared (PR merged/closed)
- **WHEN** a user replies in that thread
- **THEN** Claude reads the thread context from Slack which contains the PR URL and outcome
- **AND** Claude can answer questions about the change, propose a new one, or act on the PR via GitHub MCP

#### Scenario: Action on unrelated PR in active change thread

- **GIVEN** a thread has an active change on branch X with PR #123
- **WHEN** the user asks Claude to act on a different PR (e.g., "comment on PR #456 on repo Y")
- **THEN** Claude identifies the target as PR #456 on repo Y, not the active change's PR
- **AND** Claude uses GitHub MCP tools to fulfill the request
- **AND** the active change context is unaffected

#### Scenario: Review command execution

- **GIVEN** an update that involves reviewing PR feedback is requested
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
- **AND** Claude calls `merge_pr` which handles the merge, branch cleanup, and clearing `activeChange` from the session
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
- **AND** Claude calls `close_pr` which handles closing, optional branch deletion, and clearing `activeChange` from the session
- **AND** Claude reports the result via `report_status`

#### Scenario: Follow-up as question

- **GIVEN** a thread with or without active change execution
- **WHEN** Claude determines the message is a question (not an action request)
- **THEN** Claude responds with a standard Q&A answer via `submit_response`

## REMOVED Requirements

### Requirement: Thread Follow-up Commands
**Reason**: The original requirement gated follow-up tools (`request_review`, `request_merge`, `request_update`, `request_close`) on the existence of an active `ChangeSession`. These session-bound action tools are replaced by Claude's intent analysis combined with GitHub MCP tools (for PR operations) and the existing `propose_change` / worktree execution flow (for code changes). Claude decides what to do based on message content, not tool availability gating.
**Migration**: Remove `request_review`, `request_merge`, `request_close` tools. Keep `request_update` only if a worktree exists for code changes (or replace with Claude using GitHub MCP + `propose_change` for new worktree-based work). PR merges, closes, and comments go through GitHub MCP directly.
