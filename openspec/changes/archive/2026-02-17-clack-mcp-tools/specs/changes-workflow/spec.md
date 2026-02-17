## MODIFIED Requirements

### Requirement: Change Request Detection

The system SHALL detect change request intent via the `propose_change` MCP tool call instead of XML tag parsing.

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
- **THEN** the system replies in the thread with PR URL, summary, and commit count

#### Scenario: Failure notification

- **GIVEN** change execution or PR creation failed
- **WHEN** the workflow fails
- **THEN** the system replies in the thread with error message and suggestions

### Requirement: Thread Follow-up Commands

The system SHALL support follow-up commands in change threads via MCP tools instead of XML tags.

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

## REMOVED Requirements

### Requirement: Change Request Detection

**Reason**: The XML-tag-based detection system (`<change-request>`, `<resume-request>` tags, `CHANGE_REQUEST_BLOCK` and `RESUMABLE_SESSIONS` prompt variables, `parseChangeRequest()` and `parseResumeRequest()` functions) is replaced by MCP tools (`propose_change`, `find_sessions` query tool, `submit_response` with choice actions).

**Migration**: Remove `<change-request>` and `<resume-request>` XML format instructions from dev/admin instruction files. Remove `{CHANGE_REQUEST_BLOCK}` and `{RESUMABLE_SESSIONS}` variable placeholders. The change detection heuristics (question vs change request) move to lighter system prompt guidance since Claude now expresses intent via tool calls rather than tag selection.
