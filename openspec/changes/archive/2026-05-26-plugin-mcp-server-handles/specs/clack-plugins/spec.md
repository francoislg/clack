## ADDED Requirements

### Requirement: ClackSdk Exposes Implicit Default MCP Server

The `ClackSdk` interface SHALL expose a `mcpServer: RegisteredMcpServer` property — an implicit always-on MCP server per plugin, named after the plugin (`mcp__<pluginName>__*`). Tools registered via the SDK shorthand `sdk.registerTool(...)` (no handle) SHALL be bound to this default server, preserving the call shape used by simple plugins (giphy, tenor-gif, skill-pack plugins) that have no on-demand surface.

#### Scenario: Default server exists on every plugin's SDK instance

- **WHEN** the system creates a `ClackSdk` instance for a plugin during loading
- **THEN** the instance exposes a `mcpServer` property of type `RegisteredMcpServer`
- **AND** the property is non-null and stable across calls within the same SDK instance

#### Scenario: Shorthand registerTool routes through the default server

- **WHEN** a plugin calls `sdk.registerTool("admin", toolDef, "Some label")`
- **THEN** the tool is bound to `sdk.mcpServer` (the default always-on server)
- **AND** the tool appears at `mcp__<pluginName>__<toolName>` in the assembled catalog
- **AND** the behavior is identical to calling `sdk.mcpServer.registerTool("admin", toolDef, "Some label")` directly

### Requirement: ClackSdk Exposes `registerMcpServer` Returning a Handle

The `ClackSdk` interface SHALL include a `registerMcpServer(name: string, options: { autoload?: boolean; description: string }): RegisteredMcpServer` method that declares an on-demand named MCP server scoped to the plugin and returns a handle for binding tools and topic instructions to it. The SDK SHALL automatically prefix `name` with the plugin name (`<pluginName>:<name>`) when surfacing the server publicly; `name` itself SHALL NOT contain a colon (the SDK rejects names containing `:` to prevent double-prefixing).

The returned `RegisteredMcpServer` handle SHALL expose two methods:

- `registerTool(minRole, toolDef, mappingOrOptions?)` — same signature as `sdk.registerTool` minus any integration option. Binds the tool to this server.
- `addTopicInstruction(role, filename, content)` — adds a topic instruction whose topic name is the server's full public name (`<pluginName>:<name>`).

#### Scenario: Plugin declares an on-demand server and receives a handle

- **WHEN** a plugin calls `sdk.registerMcpServer("management", { autoload: false, description: "Manage trivia games" })`
- **THEN** the call returns a `RegisteredMcpServer` handle
- **AND** the SDK records the server with full public name `<pluginName>:management` (e.g., `trivia:management`)
- **AND** the SDK records the description and `autoload: false` for use in the effective MCP registry

#### Scenario: Handle's registerTool binds the tool to that server

- **WHEN** a plugin captures a handle `const m = sdk.registerMcpServer("management", { autoload: false, description: "..." })`
- **AND** calls `m.registerTool("admin", upsertSeasonTool, "Upserting season — {game}")`
- **THEN** the tool is bound to the `trivia:management` server (not to the default `trivia` server)
- **AND** the tool appears at `mcp__trivia_management__upsert_season` in the assembled catalog (only after attach, per "Plugin MCP Server Membership Gating")

#### Scenario: Handle's addTopicInstruction auto-keys the topic to the server name

- **WHEN** a plugin calls `m.addTopicInstruction("admin", "manage.md", "...content...")` on a handle returned by `registerMcpServer("management", ...)`
- **THEN** the instruction is added under topic name `<pluginName>:management` (e.g., `trivia:management`)
- **AND** the result is identical to calling `sdk.addTopicInstruction("admin", "<pluginName>:management", "manage.md", "...content...")`

#### Scenario: registerMcpServer rejects names containing colons

- **WHEN** a plugin calls `sdk.registerMcpServer("trivia:management", { ... })`
- **THEN** the call rejects with an error indicating the name must not contain `:`
- **AND** no server is registered

#### Scenario: registerMcpServer rejects collision with the plugin's default server

- **WHEN** a plugin calls `sdk.registerMcpServer("", ...)` (or any name that would resolve to the bare plugin name)
- **THEN** the call rejects with an error explaining the implicit default server already exists at `sdk.mcpServer`

#### Scenario: autoload defaults to false

- **WHEN** a plugin calls `sdk.registerMcpServer("management", { description: "..." })` (autoload omitted)
- **THEN** the SDK treats the server as on-demand (`autoload: false`)
- **AND** the server is NOT part of the session-start baseline unless `attachedIntegrations` already contains its full public name (resume case)

### Requirement: Plugin MCP Server Membership Gating

The system SHALL filter plugin-registered MCP servers at tool-server assembly time based on `autoload` and `session.attachedIntegrations`. The plugin's implicit default server (`sdk.mcpServer`) is always assembled. On-demand servers registered via `sdk.registerMcpServer(name, { autoload: false, ... })` SHALL be assembled into the SDK's baseline only when `session.attachedIntegrations` contains the server's full public name (`<pluginName>:<name>`). On-demand servers SHALL otherwise be registered with `McpServerManager` so that `attach_integration` can attach them mid-session via the existing `setMcpServers` path.

The per-tool role gate SHALL still apply: a tool registered on a server is included in the assembled catalog only when the user's role meets or exceeds the tool's `minRole`, independently of whether the server is in the baseline.

#### Scenario: On-demand server's tools are absent from the baseline when not attached

- **GIVEN** a plugin registers `const m = sdk.registerMcpServer("management", { autoload: false, description: "..." })` and binds tool `foo` via `m.registerTool(...)`
- **AND** an admin session has `attachedIntegrations: []`
- **WHEN** the tool server assembles the catalog
- **THEN** `mcp__<pluginName>_management__foo` is NOT in the returned tool names
- **AND** the on-demand server's SDK config IS registered with `McpServerManager` for later mid-session attach

#### Scenario: On-demand server's tools are present in the baseline when attached at session start (resume)

- **GIVEN** the same plugin registration
- **AND** an admin session has `attachedIntegrations: ["<pluginName>:management"]` (e.g., from a prior turn's `attach_integration` call)
- **WHEN** the tool server assembles the catalog
- **THEN** `mcp__<pluginName>_management__foo` IS in the returned tool names
- **AND** the on-demand server's SDK config IS in the assembled `mcpServers` map (so the SDK's restored session state matches `options.mcpServers`)

#### Scenario: Default server is always assembled

- **GIVEN** a plugin registers tool `bar` via `sdk.registerTool(...)` (shorthand into the default server)
- **AND** an admin session has `attachedIntegrations: []`
- **WHEN** the tool server assembles the catalog
- **THEN** `mcp__<pluginName>__bar` IS in the returned tool names

#### Scenario: Role gate still applies independently of server membership

- **GIVEN** a plugin registers an admin-only tool `foo` on an on-demand server `<pluginName>:management`
- **AND** a `dev`-role session has `attachedIntegrations: ["<pluginName>:management"]`
- **WHEN** the tool server assembles the catalog
- **THEN** the tool is absent (the role gate fails even though the server is attached)

## REMOVED Requirements

### Requirement: Plugin Tool Integration Gating

**Reason**: Replaced by "Plugin MCP Server Membership Gating". The new design binds tools to a server (via `registerMcpServer` handle or the implicit default), and gating is decided at the server level, not by re-checking a per-tool `integration` string. The behavioral outcome (tools visible iff their server is attached) is preserved.

**Migration**: Plugins that called `sdk.registerTool(..., { integration: "<name>" })` must:
1. Replace the `registerIntegration(name, ...)` call with `const handle = sdk.registerMcpServer(<key>, { autoload: false, description: ... })` (where `<key>` is the part after `<pluginName>:` in the old integration name).
2. Replace each `sdk.registerTool(..., { integration: "<name>" })` call with `handle.registerTool(...)`.
3. The MCP tool name changes from `mcp__<pluginName>__<tool>` to `mcp__<pluginName>_<key>__<tool>`. Update any persisted `requiredTools` lists and test assertions referencing the old names.

### Requirement: Plugin-Declared Integration Catalog Entries

**Reason**: Replaced by `registerMcpServer`. The new method declares a server *and* its catalog entry in one call; the separate `registerIntegration` primitive no longer adds anything beyond what the handle-based API provides.

**Migration**: Plugins that called `sdk.registerIntegration(name, { description, alwaysLoad: false })` must replace it with `sdk.registerMcpServer(<key>, { autoload: false, description })`, where `<key>` is the part of `name` after `<pluginName>:`. The catalog entry semantics (description shown to Claude, `alwaysLoad`/`autoload` honored) are preserved.

## MODIFIED Requirements

### Requirement: ClackSdk Interface

The system SHALL provide a `ClackSdk` interface with methods for instruction registration, tool registration, scoped file I/O, and on-demand MCP server declaration.

#### Scenario: addInstruction method
- **WHEN** a plugin calls `sdk.addInstruction("user", "instructions", content)`
- **THEN** the SDK stores the content as a virtual default file
- **AND** the filename is automatically prefixed with the plugin name and double underscore (e.g., `trivia__instructions.md`)
- **AND** the plugin does not need to know about the prefix convention

#### Scenario: registerTool method (shorthand into the default server)
- **WHEN** a plugin calls `sdk.registerTool("dev", toolDefinition, mapping)` (no options object)
- **THEN** the SDK records the tool with its minimum role requirement
- **AND** the tool is bound to `sdk.mcpServer` (the implicit always-on default server)
- **AND** the tool is only included in queries where the user's role meets or exceeds the minimum
- **AND** the tool is always present in the catalog regardless of `session.attachedIntegrations`

#### Scenario: readFile method scoped to plugin data directory
- **WHEN** a plugin calls `sdk.readFile("scores.json")`
- **THEN** the SDK resolves the path to `data/plugins/{pluginName}/scores.json`
- **AND** returns the file content as a string, or `null` if the file does not exist

#### Scenario: writeFile method scoped to plugin data directory
- **WHEN** a plugin calls `sdk.writeFile("scores.json", content)`
- **THEN** the SDK writes the content to `data/plugins/{pluginName}/scores.json`
- **AND** creates the plugin data directory if it does not exist

#### Scenario: Path traversal rejected
- **WHEN** a plugin calls `sdk.readFile("../other-plugin/data.json")`
- **THEN** the SDK rejects the call with an error
- **AND** does not access files outside the plugin's data directory
