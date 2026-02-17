# clack-tools Specification

## Purpose
In-process MCP tool server providing query, action, and presentation tools to Claude during Slack bot queries. Tools are built per-query with closure-captured context and gated by user role.

## Requirements
### Requirement: In-Process MCP Tool Server

The system SHALL provide an in-process MCP tool server using the Agent SDK's `createSdkMcpServer()` function, registered as the `clack` MCP server alongside external servers.

#### Scenario: Tool server created per query

- **WHEN** `askClaude()` prepares a query
- **THEN** the system builds a fresh `clack` MCP server via `createSdkMcpServer()`
- **AND** passes it in the `mcpServers` option alongside external MCP servers (GitHub, Sentry, etc.)
- **AND** the server is scoped to the lifetime of that single query

#### Scenario: Tool server captures query context via closure

- **WHEN** the tool server is built
- **THEN** tool handlers close over the query context: user identity, role, session state, available repositories, active change sessions, and configuration
- **AND** tool handlers do NOT require Claude to pass context as tool parameters

### Requirement: Tool Context

The system SHALL define a typed context object passed to the per-query tool builder.

#### Scenario: Context includes user identity and role

- **WHEN** the tool builder is called
- **THEN** the context includes the user's Slack ID and resolved role (member, dev, admin, owner)

#### Scenario: Context includes session state

- **WHEN** the tool builder is called
- **THEN** the context includes the current session (Q&A session or change thread session)
- **AND** includes whether the current thread has an active change session with a PR

#### Scenario: Context includes system configuration

- **WHEN** the tool builder is called
- **THEN** the context includes the list of configured repositories, whether the changes workflow is enabled, and config file metadata

### Requirement: Role-Based Tool Gating

The system SHALL register tools based on the user's role and current context.

#### Scenario: Member user tool set

- **WHEN** the user has the member role
- **THEN** the tool server registers query tools (`list_repositories`) and `submit_response`
- **AND** does NOT register action tools (`propose_change`, `propose_config_update`)

#### Scenario: Dev user tool set

- **GIVEN** the changes workflow is enabled for the trigger type
- **WHEN** the user has the dev role (or higher)
- **THEN** the tool server registers all query tools, `propose_change`, and `submit_response`

#### Scenario: Dev user in change thread

- **GIVEN** the current thread has an active change session with a PR
- **WHEN** the user has the dev role (or higher)
- **THEN** the tool server additionally registers `request_review`, `request_merge`, `request_update`, and `request_close`

#### Scenario: Admin user tool set

- **GIVEN** the user has the admin or owner role
- **WHEN** the tool server is built
- **THEN** it additionally registers `propose_config_update`

### Requirement: Query Tools

The system SHALL provide read-only query tools for discovering system state.

#### Scenario: list_repositories tool

- **WHEN** Claude calls `list_repositories`
- **THEN** the tool returns an array of configured repositories with name, description, and whether the repo supports changes
- **AND** the tool has no side effects

#### Scenario: find_sessions tool

- **WHEN** Claude calls `find_sessions` with optional filters (status, repo, branch)
- **THEN** the tool returns matching change sessions with branch, repo, phase, description, and creation time
- **AND** includes worktree existence information for each session

#### Scenario: find_changes tool

- **WHEN** Claude calls `find_changes` with optional filters (repo, status)
- **THEN** the tool returns active change requests with branch, repo, description, phase, and PR URL if available

#### Scenario: list_config_files tool

- **WHEN** Claude calls `list_config_files`
- **THEN** the tool returns the list of known instruction files with filename and status (customized, default, or not created)

### Requirement: Action Tools

The system SHALL provide action tools that validate intent and return staged references.

#### Scenario: propose_change tool validates and stages

- **WHEN** Claude calls `propose_change` with branch, description, and repo
- **THEN** the tool validates: branch follows `clack/{type}/{name}` convention, repo exists in configuration, repo supports changes, user has dev role
- **AND** checks for existing worktrees on the same branch
- **AND** on success, stages the intent and returns a ref ID
- **AND** on failure, returns an error message Claude can use to retry

#### Scenario: propose_change detects existing worktree

- **GIVEN** a worktree already exists for the specified branch and repo
- **WHEN** Claude calls `propose_change`
- **THEN** the tool returns the existing worktree info (branch, status, last activity) alongside the ref ID
- **AND** Claude can present a choice to the user: resume existing or start fresh

#### Scenario: propose_config_update tool validates and stages

- **WHEN** Claude calls `propose_config_update` with file and content
- **THEN** the tool validates: filename is in the known instruction files list, content is non-empty
- **AND** on success, stages the intent and returns a ref ID
- **AND** on failure, returns an error message Claude can use to retry

#### Scenario: Action tool retry on validation error

- **GIVEN** Claude calls an action tool with invalid parameters
- **WHEN** the tool returns an error
- **THEN** Claude receives the error message in the tool response
- **AND** Claude can call the tool again with corrected parameters

### Requirement: Change Thread Follow-Up Tools

The system SHALL provide action tools for change thread operations, available only when an active change session exists.

#### Scenario: request_review tool

- **WHEN** Claude calls `request_review` in a change thread
- **THEN** the tool validates that the session has a PR URL
- **AND** stages a review intent and returns a ref ID

#### Scenario: request_merge tool

- **WHEN** Claude calls `request_merge` in a change thread
- **THEN** the tool validates that the session has a PR URL and the PR is open
- **AND** stages a merge intent and returns a ref ID

#### Scenario: request_update tool

- **WHEN** Claude calls `request_update` with additional instructions
- **THEN** the tool validates that the session has an active worktree
- **AND** stages an update intent with the instructions and returns a ref ID

#### Scenario: request_close tool

- **WHEN** Claude calls `request_close` in a change thread
- **THEN** the tool validates that the session has a PR URL and the PR is open
- **AND** stages a close intent and returns a ref ID

### Requirement: Staged Intent Storage

The system SHALL maintain a per-query Map of staged intents for reference resolution.

#### Scenario: Intent stored on action tool success

- **WHEN** an action tool validates successfully
- **THEN** the intent (type + validated parameters) is stored in a Map keyed by a generated ref ID
- **AND** the ref ID is returned to Claude

#### Scenario: Intent resolved by submit_response

- **WHEN** `submit_response` includes an action with a ref
- **THEN** the system resolves the ref from the staged intents Map
- **AND** attaches the validated data to the action for the button handler

#### Scenario: Intents serialized to session

- **WHEN** the query completes
- **THEN** staged intents referenced in the final `submit_response` are serialized into the session
- **AND** button handlers can resolve refs even after the query closure is garbage collected
