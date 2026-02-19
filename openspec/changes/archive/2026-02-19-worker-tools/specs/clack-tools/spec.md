## MODIFIED Requirements

### Requirement: Tool Context

The system SHALL define a typed context object passed to the per-query tool builder.

#### Scenario: Context includes user identity and role
- **WHEN** the tool builder is called in query mode
- **THEN** the context includes the user's Slack ID and resolved role (member, dev, admin, owner)

#### Scenario: Context includes session state
- **WHEN** the tool builder is called in query mode
- **THEN** the context includes the current session (Q&A session or change thread session)
- **AND** includes whether the current thread has an active change session with a PR

#### Scenario: Context includes filtered repositories
- **WHEN** the tool builder is called in query mode
- **THEN** the context includes only repositories the user has read access to
- **AND** tools operate on this filtered list, not the full config

#### Scenario: Worker context includes worktree and session info
- **WHEN** the tool builder is called in a worker mode (execute, update, review, merge, close)
- **THEN** the context includes the worktree path, branch name, repo name, and repo URL
- **AND** includes the Slack channel ID and thread timestamp (for `report_status`)
- **AND** includes the change session ID (for session state updates)
- **AND** includes the app configuration

### Requirement: In-Process MCP Tool Server

The system SHALL provide an in-process MCP tool server using the Agent SDK's `createSdkMcpServer()` function, registered as the `clack` MCP server alongside external servers.

#### Scenario: Tool server created per query
- **WHEN** `askClaude()` prepares a query
- **THEN** the system builds a fresh `clack` MCP server via `createSdkMcpServer()`
- **AND** passes it in the `mcpServers` option alongside external MCP servers (GitHub, Sentry, etc.)
- **AND** the server is scoped to the lifetime of that single query

#### Scenario: Tool server created per worker invocation
- **WHEN** a worker Claude invocation is prepared (execute, update, review, merge, close)
- **THEN** the system builds a fresh `clack` MCP server via `createSdkMcpServer()`
- **AND** passes it in the `mcpServers` option to the Agent SDK `query()` call
- **AND** the server is scoped to the lifetime of that single worker invocation

#### Scenario: Tool server captures query context via closure
- **WHEN** the tool server is built
- **THEN** tool handlers close over the provided context (query or worker)
- **AND** tool handlers do NOT require Claude to pass context as tool parameters

### Requirement: Role-Based Tool Gating

The system SHALL register tools based on the user's role, current context, and invocation mode.

#### Scenario: Member user tool set
- **WHEN** the user has the member role in query mode
- **THEN** the tool server registers query tools (`list_repositories`) and `submit_response`
- **AND** does NOT register action tools (`propose_change`, `propose_config_update`)

#### Scenario: Dev user tool set
- **GIVEN** the changes workflow is enabled for the trigger type
- **WHEN** the user has the dev role (or higher) in query mode
- **THEN** the tool server registers all query tools, `propose_change`, and `submit_response`

#### Scenario: Dev user query tools include find_pull_requests
- **WHEN** the user has the dev role (or higher) in query mode
- **THEN** the tool server registers `find_pull_requests` alongside `find_sessions` and `find_changes`

#### Scenario: Dev user in change thread
- **GIVEN** the current thread has an active change session with a PR
- **WHEN** the user has the dev role (or higher) in query mode
- **THEN** the tool server additionally registers `request_review`, `request_merge`, `request_update`, and `request_close`

#### Scenario: Admin user tool set
- **GIVEN** the user has the admin or owner role
- **WHEN** the tool server is built in query mode
- **THEN** it additionally registers `propose_config_update`

#### Scenario: Dev instructions include auto-execute guidance
- **GIVEN** the user has the dev role (or higher)
- **WHEN** Claude receives dev instructions
- **THEN** the instructions include guidance on when to use `auto: true` on ref-based actions
- **AND** Claude uses `auto: true` for clear directives and omits it for ambiguous intent

#### Scenario: Execute mode tool set
- **WHEN** the tool server is built with mode `execute`
- **THEN** it registers `git_push`, `ensure_pr`, and `report_status`
- **AND** does NOT register query, action, or presentation tools

#### Scenario: Update mode tool set
- **WHEN** the tool server is built with mode `update`
- **THEN** it registers `git_push` and `report_status`

#### Scenario: Review mode tool set
- **WHEN** the tool server is built with mode `review`
- **THEN** it registers `git_push` and `report_status`

#### Scenario: Merge mode tool set
- **WHEN** the tool server is built with mode `merge`
- **THEN** it registers `merge_pr` and `report_status`

#### Scenario: Close mode tool set
- **WHEN** the tool server is built with mode `close`
- **THEN** it registers `close_pr` and `report_status`
