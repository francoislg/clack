## MODIFIED Requirements

### Requirement: In-Process MCP Tool Server

The system SHALL provide in-process MCP tool servers using the Agent SDK's `createSdkMcpServer()` function. In query mode the assembly returns a `Record<string, McpServerConfig>` containing one `clack` server for core tools plus one dedicated server per loaded plugin (keyed by plugin name). In worker mode the assembly returns a single `clack` server instance. This is a breaking change from the prior single-server query-mode return shape.

#### Scenario: Query-mode tool assembly returns a record of MCP servers

- **WHEN** `askClaude()` prepares a query and calls the query-mode tool assembly
- **THEN** the assembly returns an `mcpServers` record whose keys include `clack` and one entry per loaded plugin (keyed by plugin name)
- **AND** the caller spreads this record into the Agent SDK's `mcpServers` option alongside external servers (GitHub, Sentry, etc.)
- **AND** each server is scoped to the lifetime of that single query

#### Scenario: Worker-mode tool assembly returns a single server

- **WHEN** a worker Claude invocation is prepared
- **THEN** the assembly returns a single `clack` MCP server
- **AND** no plugin servers are produced in worker mode
- **AND** the server is passed in the `mcpServers` option to the Agent SDK `query()` call

#### Scenario: Tool server captures query context via closure

- **WHEN** a tool server is built
- **THEN** tool handlers close over the provided context (query or worker)
- **AND** tool handlers do NOT require Claude to pass context as tool parameters

#### Scenario: Reaction tools registered when Slack client available

- **WHEN** the `clack` core tool server is built in query mode
- **AND** a Slack client is available in the context
- **THEN** the core server registers the `add_reaction` and `remove_reaction` tools
- **AND** both tools are available to all roles (no role gating)

### Requirement: Role-Based Tool Gating

The system SHALL register tools based on the user's role, workflow configuration, feature flags, and active plugins. Core tools go into the `clack` MCP server; plugin tools go into each plugin's own MCP server. Plugin-registered tools are included when the user's role meets the declared minimum.

#### Scenario: Member user tool set

- **WHEN** the user has the member role in query mode
- **THEN** the `clack` server registers core query tools and `submit_response`
- **AND** registers `find_user`, `find_emoji`, and `upload_file` if a Slack client is available
- **AND** registers scheduling tools if `allowScheduledMessages` is enabled and a Slack client is available
- **AND** each plugin server registers that plugin's tools where the declared minimum role is `member`
- **AND** plugin servers do NOT register tools with a higher minimum role

#### Scenario: Dev user tool set with plugins

- **GIVEN** the changes workflow is enabled for the trigger type
- **AND** a plugin has registered tools with minimum role `dev`
- **WHEN** the user has the dev role (or higher) in query mode
- **THEN** the `clack` server registers all core query tools, change tools, and `submit_response`
- **AND** each plugin server registers that plugin's tools with minimum role `member` or `dev`
- **AND** plugin servers do NOT register tools with minimum role `admin` or `owner`

#### Scenario: Plugin tools not included in worker mode

- **WHEN** the tool server is built with mode `"worker"`
- **THEN** the assembly produces only the `clack` core worker server (`git_push`, `ensure_pr`, `merge_pr`, `close_pr`, `report_status`)
- **AND** no plugin MCP servers are produced
- **AND** plugin tool registration is strictly query-mode only

#### Scenario: Plugin tools live in per-plugin servers, not in `clack`

- **GIVEN** plugins have registered tools
- **WHEN** the query-mode assembly runs
- **THEN** each plugin's tools are placed in a dedicated `createSdkMcpServer({ name: pluginName, ... })` instance
- **AND** no plugin tool is added to the `clack` server
- **AND** Claude sees each plugin's tools as `mcp__<plugin>__<tool>`

#### Scenario: Tool name collision with core tools is structurally impossible

- **GIVEN** a plugin registers a tool with the same bare name as a core tool (e.g., `submit_response`)
- **WHEN** the query-mode assembly runs
- **THEN** both tools load successfully because they live in different MCP servers
- **AND** Claude sees the core tool as `mcp__clack__submit_response` and the plugin tool as `mcp__<plugin>__submit_response`
- **AND** no warning about duplication is logged (the prior collision guard is no longer necessary)
