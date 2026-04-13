## MODIFIED Requirements

### Requirement: In-Process MCP Tool Server

The system SHALL provide an in-process MCP tool server using the Agent SDK's `createSdkMcpServer()` function, registered as the `clack` MCP server alongside external servers.

#### Scenario: Tool server created per query

- **WHEN** `askClaude()` prepares a query
- **THEN** the system builds a fresh `clack` MCP server via `createSdkMcpServer()`
- **AND** passes it in the `mcpServers` option alongside external MCP servers (GitHub, Sentry, etc.)
- **AND** the server is scoped to the lifetime of that single query

#### Scenario: Tool server created per worker invocation

- **WHEN** a worker Claude invocation is prepared
- **THEN** the system builds a fresh `clack` MCP server via `createSdkMcpServer()`
- **AND** passes it in the `mcpServers` option to the Agent SDK `query()` call
- **AND** the server is scoped to the lifetime of that single worker invocation

#### Scenario: Tool server captures query context via closure

- **WHEN** the tool server is built
- **THEN** tool handlers close over the provided context (query or worker)
- **AND** tool handlers do NOT require Claude to pass context as tool parameters

#### Scenario: Reaction tools registered when Slack client available

- **WHEN** the tool server is built in query mode
- **AND** a Slack client is available in the context
- **THEN** the tool server registers the `add_reaction` and `remove_reaction` tools
- **AND** both tools are available to all roles (no role gating)
