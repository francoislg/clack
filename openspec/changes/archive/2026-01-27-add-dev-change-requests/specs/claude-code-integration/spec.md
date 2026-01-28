## ADDED Requirements

### Requirement: Autonomous Change Execution

The system SHALL support an autonomous change execution mode for implementing code changes without user interaction.

#### Scenario: Execute change with default tools
- **WHEN** a change request is triggered by an authorized dev
- **THEN** the system spawns a new Claude instance with a change-focused system prompt
- **AND** allows default tools: `Read`, `Glob`, `Grep`, `Write`, `Edit`, `Bash`
- **AND** sets `cwd` to the worktree directory
- **AND** always disallows `Task` tool

#### Scenario: Worktree sandbox enforcement
- **WHEN** Claude executes in change mode
- **THEN** all file operations are restricted to the worktree directory
- **AND** Bash commands run with `cwd` set to the worktree
- **AND** attempts to access files outside the worktree are blocked
- **AND** no access to parent directories, other repositories, or system paths

#### Scenario: Additional allowed tools from config
- **WHEN** `changesWorkflow.additionalAllowedTools` is configured
- **THEN** the system adds those tools to the allowed list
- **AND** merges them with the default allowed tools
- **AND** tools like `WebFetch`, `WebSearch` can be enabled this way

#### Scenario: Change system prompt
- **WHEN** the autonomous Claude instance is spawned
- **THEN** the system prompt instructs Claude to:
  - Analyze the change request
  - Explore the codebase to understand context
  - Implement the requested change
  - Run tests if available
  - Commit changes with a descriptive message
  - Output the final commit hash and summary

#### Scenario: Execution timeout
- **WHEN** change execution exceeds the configured timeout (default 10 minutes)
- **THEN** the system aborts the Claude process
- **AND** cleans up the worktree
- **AND** reports failure to the user

#### Scenario: Execution result capture
- **WHEN** Claude completes execution
- **THEN** the system captures the commit hash from the result
- **AND** captures any error messages if execution failed
- **AND** passes the result to the PR creation flow

### Requirement: PR Template Resolution

The system SHALL resolve PR templates from multiple sources in priority order.

#### Scenario: Template from repository
- **WHEN** preparing to create a PR
- **THEN** the system checks the worktree for templates in order:
  - `.github/PULL_REQUEST_TEMPLATE.md`
  - `.github/pull_request_template.md`
  - `docs/PULL_REQUEST_TEMPLATE.md`
- **AND** uses the first template found

#### Scenario: Template from Clack data directory
- **GIVEN** no template found in the repository
- **WHEN** preparing to create a PR
- **THEN** the system checks for `data/templates/pr-template.md`
- **AND** uses it if present

#### Scenario: Built-in default template
- **GIVEN** no template found in repo or data directory
- **WHEN** preparing to create a PR
- **THEN** the system uses a minimal built-in template with:
  - Summary section
  - Changes section
  - Test plan section

#### Scenario: PR instructions from config
- **WHEN** `changesWorkflow.prInstructions` is configured
- **THEN** the instructions are appended to Claude's system prompt
- **AND** Claude follows them when writing the PR description

### Requirement: Autonomous PR Creation

The system SHALL create PRs using the GitHub CLI after successful change execution.

#### Scenario: Create PR via gh CLI
- **GIVEN** a successful change execution with commits
- **WHEN** the PR creation step runs
- **THEN** the system invokes `gh pr create` in the worktree
- **AND** uses the resolved template for the PR body
- **AND** sets the title based on the change summary
- **AND** targets the repository's default branch

#### Scenario: PR creation failure handling
- **WHEN** `gh pr create` fails
- **THEN** the system captures the error message
- **AND** reports the failure to the user
- **AND** preserves the worktree for manual recovery

### Requirement: PR Review and Update

The system SHALL support reviewing PR comments and implementing requested changes.

#### Scenario: Fetch PR comments
- **GIVEN** a PR was created and user requests "review"
- **WHEN** the review flow starts
- **THEN** the system fetches PR comments via `gh pr view --comments --json`
- **AND** fetches review comments via `gh api` for inline comments
- **AND** passes comments to Claude for analysis

#### Scenario: Implement review feedback
- **GIVEN** PR comments have been fetched
- **WHEN** Claude analyzes the review comments
- **THEN** it implements the requested changes in the worktree
- **AND** commits changes with a message referencing the review
- **AND** pushes to update the PR

#### Scenario: Report review changes
- **WHEN** review changes are pushed
- **THEN** the system replies in the Slack thread with:
  - Number of comments addressed
  - Summary of changes made
  - Note if any comments could not be addressed

### Requirement: PR Merge

The system SHALL support merging PRs when requested by authorized users.

#### Scenario: Merge PR via gh CLI
- **GIVEN** a PR exists and user requests "merge"
- **WHEN** the merge flow starts
- **THEN** the system invokes `gh pr merge` with the configured strategy
- **AND** uses the repository's configured merge strategy (squash/merge/rebase)
- **AND** defaults to squash merge if not configured

#### Scenario: Merge strategy configuration
- **WHEN** a repository config includes `mergeStrategy`
- **THEN** that strategy is used for merging PRs from that repo
- **AND** valid values are: `squash`, `merge`, `rebase`

#### Scenario: Merge failure handling
- **WHEN** `gh pr merge` fails
- **THEN** the system captures the error message
- **AND** reports the failure reason to the user (conflicts, CI failed, etc.)
- **AND** suggests next steps (resolve conflicts, wait for CI, etc.)

#### Scenario: Cleanup after merge
- **GIVEN** a PR was successfully merged
- **WHEN** the merge completes
- **THEN** the system removes the worktree
- **AND** deletes the local branch
- **AND** reports success in the Slack thread
