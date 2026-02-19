## MODIFIED Requirements

### Requirement: Autonomous Change Execution

The system SHALL support an autonomous change execution mode for implementing code changes without user interaction.

#### Scenario: Execute change with default tools and MCP server
- **WHEN** a change request is triggered by an authorized dev
- **THEN** the system builds worker tools via `buildClackTools()` with mode `execute`
- **AND** invokes the Agent SDK `query()` function with a change-focused system prompt
- **AND** passes the `clack` MCP server in the `mcpServers` option
- **AND** allows default tools: `Read`, `Glob`, `Grep`, `Write`, `Edit`, `Bash`
- **AND** sets `cwd` to the worktree directory
- **AND** always disallows `Task` tool
- **AND** sets `permissionMode` to `bypassPermissions` with `allowDangerouslySkipPermissions: true`
- **AND** sets `persistSession` to `false`

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

#### Scenario: Change system prompt references MCP tools
- **WHEN** the autonomous Claude instance is invoked
- **THEN** the system prompt instructs Claude to:
  - Analyze the change request
  - Explore the codebase to understand context
  - Implement the requested change
  - Run tests if available
  - Commit changes with a descriptive message
  - Push the branch using the `git_push` tool
  - Create a PR using the `ensure_pr` tool
  - Report progress and results using the `report_status` tool

#### Scenario: Execution timeout
- **WHEN** change execution exceeds the configured timeout (default 10 minutes)
- **THEN** the system aborts the query via `AbortController`
- **AND** checks session state to determine partial completion (e.g., committed but not pushed)

#### Scenario: Execution result from session state
- **WHEN** Claude completes execution
- **THEN** the orchestrator reads the session's `prUrl` and status to determine outcome
- **AND** does NOT parse text markers from Claude's output

#### Scenario: Git author attribution
- **WHEN** a change execution is invoked
- **THEN** the system passes `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, and `GIT_COMMITTER_EMAIL` via the SDK `env` option
- **AND** spreads `process.env` to preserve the existing environment

#### Scenario: Worktree-aware Claude invocation
- **WHEN** any Claude invocation targets a worktree directory
- **THEN** the system SHALL use the worktree-aware invocation wrapper
- **AND** the wrapper refreshes the git remote authentication token before invoking the SDK
- **AND** the wrapper requires `repoName` and `worktreePath` as mandatory parameters
- **AND** direct `runClaude()` calls in worktree contexts are not permitted

#### Scenario: Auth refresh covers all worktree operations
- **GIVEN** the worktree-aware wrapper is used
- **WHEN** Claude is invoked for any worktree operation (execution, review, update, setup, intent detection)
- **THEN** the remote URL is updated with a fresh installation token
- **AND** this occurs regardless of whether the specific operation involves git push

### Requirement: Claude Code Subprocess Invocation
The system SHALL use the Claude Agent SDK for answer generation requests.

#### Scenario: Query via Agent SDK
- **WHEN** answer generation is requested
- **THEN** the system calls the Agent SDK `query()` function
- **AND** passes the question and context as the prompt
- **AND** configures `cwd` to point to the repositories directory
- **AND** loads external MCP servers asynchronously (awaiting token generation if needed)
- **AND** builds the in-process `clack` MCP server with query context
- **AND** passes both external and clack MCP servers in `mcpServers`
- **AND** captures the `submit_response` tool call output as the structured response

#### Scenario: Model configurable
- **WHEN** the system starts
- **THEN** it reads the model name from configuration
- **AND** passes it to the SDK for all queries

### Requirement: `runClaude` MCP Server Support

The system SHALL support passing MCP servers to the `runClaude()` function for worker invocations.

#### Scenario: MCP servers passed to Agent SDK
- **WHEN** `runClaude()` is called with an `mcpServers` option
- **THEN** the system passes the MCP servers to the Agent SDK `query()` call
- **AND** the Agent SDK makes the MCP tools available to Claude during execution

#### Scenario: MCP servers optional
- **WHEN** `runClaude()` is called without `mcpServers`
- **THEN** the system invokes the Agent SDK without MCP servers (backwards compatible)
- **AND** Claude has access only to the standard allowed tools

## REMOVED Requirements

### Requirement: Autonomous PR Creation
**Reason**: PR creation is now handled by the `ensure_pr` MCP tool that Claude calls during execution. The orchestrator no longer creates PRs directly.
**Migration**: Remove `ensurePR()` calls from `startChangeWorkflow()`. The `ensure_pr` tool in `worker-tools` handles push, PR creation, and session state updates.

### Requirement: PR Review and Update
**Reason**: Review execution is now tool-driven. The orchestrator builds a review prompt with fetched PR comments and runs Claude with `review` mode tools. Claude pushes via `git_push` tool instead of direct code.
**Migration**: Remove `reviewPR()` from `pr.ts`. Move PR comment fetching to the orchestrator's review prompt builder. Push and reporting happen through worker tools.

### Requirement: PR Merge
**Reason**: Merge is now handled by the `merge_pr` MCP tool that Claude calls. The orchestrator no longer calls merge functions directly.
**Migration**: Remove `mergePR()` calls from `handleFollowUp()`. The `merge_pr` tool in `worker-tools` handles merge, branch cleanup, worktree cleanup, and session updates.
