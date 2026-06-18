## MODIFIED Requirements

### Requirement: Change Request Detection

The system SHALL detect change request intent via the `propose_change` MCP tool call. The tool SHALL enforce the `clack/{type}/{name}` naming convention when creating a NEW branch, but SHALL skip that convention check when continuing an EXISTING branch (`continue_existing_pr: true`), because the branch already exists and its name is a given. The disposable-model `createWorktree` backstop SHALL mirror this carve-out — skipping its convention check when acquiring in resume-from-remote-branch mode. Regardless of continuation, the tool SHALL refuse a change targeting a protected branch (the repository's default branch, `main`, or `master`).

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

#### Scenario: Branch validation for a new branch
- **WHEN** Claude calls `propose_change` with a branch name and `continue_existing_pr` is absent or false
- **THEN** the tool validates the branch follows `clack/{type}/{name}` convention
- **AND** validates `type` is one of: fix, feat, refactor, docs, chore
- **AND** returns an error if validation fails, allowing Claude to retry

#### Scenario: Convention skipped when continuing an existing branch
- **WHEN** Claude calls `propose_change` with `continue_existing_pr: true`
- **THEN** the tool accepts the branch name without applying the `clack/{type}/{name}` convention check
- **AND** a branch name that does not match the convention (e.g. `feature/foo`) is accepted

#### Scenario: Relaxed name cannot create a junk branch
- **GIVEN** `propose_change` accepted a non-convention branch name under `continue_existing_pr: true`
- **WHEN** the worker is acquired in resume-from-remote-branch mode and the branch does not exist on the remote
- **THEN** acquisition fails with `RemoteBranchNotFound` rather than creating a new branch under that name

#### Scenario: Worktree-creation backstop honors continuation
- **WHEN** `createWorktree` is invoked with `resumeRemoteBranch` true
- **THEN** it does NOT reject the branch on the `clack/{type}/{name}` convention
- **AND** when `resumeRemoteBranch` is false it still refuses to create a worktree on a branch that does not follow the convention

#### Scenario: Protected branch refused even on continuation
- **WHEN** `propose_change` is called with `continue_existing_pr: true` and a protected branch name (the repo default, `main`, or `master`)
- **THEN** the tool returns an error and does not stage the change
- **AND** `createWorktree` likewise refuses to provision a worktree on a protected branch regardless of `resumeRemoteBranch`

#### Scenario: Repository validation in tool
- **WHEN** Claude calls `propose_change` with a repo name
- **THEN** the tool validates the repo exists in configuration and supports changes
- **AND** returns an error with the list of available repos if validation fails

#### Scenario: Existing worktree detection
- **GIVEN** a worktree already exists for the specified branch and repo
- **WHEN** Claude calls `propose_change`
- **THEN** the tool returns success with the ref ID plus existing worktree metadata (status, last activity)
- **AND** Claude can present a `choice` to the user: resume the existing session or start fresh

#### Scenario: Explicit change request via work-mode reaction
- **GIVEN** `changesWorkflow.enabled` is `true` AND `reactions.changesWorkflow.enabled` is `true`
- **WHEN** a dev+ user reacts with the work-mode emoji
- **THEN** the system processes the message through the standard `processMessage` pipeline with `workMode: true`
- **AND** Claude receives a prompt hint to use `propose_change` with `auto: true`
- **AND** the change is auto-executed without a button click

#### Scenario: Work-mode reaction from non-dev user
- **GIVEN** `reactions.changesWorkflow.enabled` is `true`
- **WHEN** a non-dev user reacts with the work-mode emoji
- **THEN** the system processes the message through the standard Q&A flow
- **AND** no change proposal tools are available (per existing role gating)
