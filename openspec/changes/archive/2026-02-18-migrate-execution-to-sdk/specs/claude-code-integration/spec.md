## MODIFIED Requirements

### Requirement: Autonomous Change Execution

The system SHALL support an autonomous change execution mode for implementing code changes without user interaction.

#### Scenario: Execute change with default tools
- **WHEN** a change request is triggered by an authorized dev
- **THEN** the system invokes the Agent SDK `query()` function with a change-focused system prompt
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

#### Scenario: Change system prompt
- **WHEN** the autonomous Claude instance is invoked
- **THEN** the system prompt instructs Claude to:
  - Analyze the change request
  - Explore the codebase to understand context
  - Implement the requested change
  - Run tests if available
  - Commit changes with a descriptive message
  - Output the final commit hash and summary

#### Scenario: Execution timeout
- **WHEN** change execution exceeds the configured timeout (default 10 minutes)
- **THEN** the system aborts the query via `AbortController`
- **AND** reports failure to the user

#### Scenario: Execution result capture
- **WHEN** Claude completes execution
- **THEN** the system captures the final text from the SDK result event
- **AND** captures any error messages if execution failed
- **AND** passes the result to the PR creation flow

#### Scenario: Git author attribution
- **WHEN** a change execution is invoked
- **THEN** the system passes `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, and `GIT_COMMITTER_EMAIL` via the SDK `env` option
- **AND** spreads `process.env` to preserve the existing environment

#### Scenario: Progress reporting
- **WHEN** the SDK yields assistant messages during execution
- **AND** a message contains a `tool_use` content block
- **THEN** the system calls the `onProgress` callback with `Using <tool_name>`

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
