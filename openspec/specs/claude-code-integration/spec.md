# claude-code-integration Specification

## Purpose
TBD - created by archiving change add-slack-reaction-bot. Update Purpose after archive.
## Requirements
### Requirement: Claude Code Subprocess Invocation
The system SHALL use the Claude Agent SDK for answer generation requests.

#### Scenario: Query via Agent SDK
- **WHEN** answer generation is requested
- **THEN** the system calls the Agent SDK `query()` function
- **AND** passes the question and context as the prompt
- **AND** configures `cwd` to point to the repositories directory
- **AND** captures the response for delivery to Slack

#### Scenario: Model configurable
- **WHEN** the system starts
- **THEN** it reads the model name from configuration
- **AND** passes it to the SDK for all queries

### Requirement: Filesystem Permission Enforcement
The system SHALL enforce read-only access to repositories by restricting allowed tools.

#### Scenario: Read-only repository access
- **WHEN** the Agent SDK query is invoked
- **THEN** the `allowedTools` option includes only `Read`, `Glob`, and `Grep`
- **AND** excludes `Write`, `Edit`, and `Bash`
- **AND** Claude can read files in cloned repositories
- **AND** Claude cannot modify any files

### Requirement: Non-Technical Response Style
The system SHALL instruct Claude Code to provide answers in broad, non-technical language suitable for non-developers by default.

#### Scenario: System prompt enforces non-technical style
- **WHEN** Claude Code subprocess is spawned
- **THEN** the system prompt instructs Claude to explain like talking to a teammate who doesn't code
- **AND** never include file paths, line numbers, function names, table/field names, or code snippets
- **AND** focus on WHAT is happening and WHY, not HOW it's implemented

#### Scenario: Technical details available only on explicit request
- **WHEN** a user explicitly asks for "more details", "technical info", or "specifics"
- **THEN** Claude Code may include code references and technical explanations
- **AND** still prioritizes clarity over exhaustive technical accuracy

### Requirement: Multi-Repository Awareness
The system SHALL inform Claude Code about all configured repositories and their purposes.

#### Scenario: Repository list in system prompt
- **WHEN** Claude Code subprocess is spawned
- **THEN** the system prompt includes the list of available repositories
- **AND** each repository's name and description from config
- **AND** instructs Claude to determine which repo(s) are relevant to the question

#### Scenario: Claude selects relevant repository
- **WHEN** Claude Code processes a question
- **THEN** it determines which repository or repositories to search
- **AND** focuses its code exploration on the selected repo(s)

### Requirement: Session Context Continuation
The system SHALL pass previous conversation context to Claude Code for follow-up questions.

#### Scenario: Refinement includes previous context
- **WHEN** a user submits a Refine action with additional instructions
- **THEN** the system passes the original question, previous answer, and new instructions to Claude Code
- **AND** Claude Code generates a response that builds on the previous context

#### Scenario: Update preserves conversation history
- **WHEN** a user clicks Update to regenerate
- **THEN** the system passes the updated message/thread context along with any previous refinements
- **AND** Claude Code considers the full conversation history

### Requirement: Output Capture and Formatting
The system SHALL capture Claude Code output and format it appropriately for Slack.

#### Scenario: Markdown to Slack formatting
- **WHEN** Claude Code produces markdown output
- **THEN** the system converts it to Slack-compatible mrkdwn format
- **AND** preserves code blocks, lists, and emphasis

#### Scenario: Long responses truncated with notice
- **WHEN** Claude Code output exceeds Slack's message size limit
- **THEN** the system truncates the response
- **AND** appends a notice that the full response was truncated

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
- **THEN** the system checks for `data/default_configuration/pr-template.md`
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

#### Scenario: Create PR via Octokit
- **GIVEN** a successful change execution with commits
- **WHEN** the PR creation step runs
- **THEN** the system pushes using token-authenticated HTTPS remote
- **AND** creates the PR via Octokit `pulls.create()` API
- **AND** uses the resolved template for the PR body
- **AND** sets the title based on the change summary
- **AND** targets the repository's default branch

#### Scenario: PR creation failure handling
- **WHEN** PR creation fails
- **THEN** the system captures the error message
- **AND** reports the failure to the user
- **AND** preserves the worktree for manual recovery

### Requirement: PR Review and Update

The system SHALL support reviewing PR comments and implementing requested changes.

#### Scenario: Fetch PR comments
- **GIVEN** a PR was created and user requests "review"
- **WHEN** the review flow starts
- **THEN** the system fetches PR review comments via Octokit `pulls.listReviewComments()`
- **AND** fetches PR reviews via Octokit `pulls.listReviews()`
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

#### Scenario: Merge PR via Octokit
- **GIVEN** a PR exists and user requests "merge"
- **WHEN** the merge flow starts
- **THEN** the system calls Octokit `pulls.merge()` with the configured strategy
- **AND** uses the repository's configured merge strategy (squash/merge/rebase)
- **AND** defaults to squash merge if not configured

#### Scenario: Merge strategy configuration
- **WHEN** a repository config includes `mergeStrategy`
- **THEN** that strategy is used for merging PRs from that repo
- **AND** valid values are: `squash`, `merge`, `rebase`

#### Scenario: Merge failure handling
- **WHEN** the Octokit merge call fails
- **THEN** the system captures the error message
- **AND** reports the failure reason to the user (conflicts, CI failed, etc.)
- **AND** suggests next steps (resolve conflicts, wait for CI, etc.)

#### Scenario: Cleanup after merge
- **GIVEN** a PR was successfully merged
- **WHEN** the merge completes
- **THEN** the system removes the worktree
- **AND** deletes the local branch
- **AND** reports success in the Slack thread

