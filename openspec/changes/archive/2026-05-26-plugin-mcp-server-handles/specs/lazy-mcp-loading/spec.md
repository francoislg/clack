## MODIFIED Requirements

### Requirement: `attach_integration` Tool

The system SHALL expose an internal tool `attach_integration(name: string)` to Claude that dynamically attaches an MCP server and returns its topic instructions. The tool SHALL be available in query-mode sessions (reactions, DMs, mentions, autoRespond, threadReply, scheduled) and hidden in worker-mode. The tool SHALL resolve the requested name through a single unified resolver: first via `loadMcpServer(name)` (external `data/mcp.json` entries), then via the per-session plugin-registered server registry on `McpServerManager` (servers declared by plugins via `sdk.registerMcpServer`). The tool SHALL be idempotent against both the dynamically-attached set AND the session-start baseline: when the requested integration is already part of the session-start baseline (e.g. `alwaysLoad: true`) and the SDK reports it as `connected`, the tool SHALL skip `setMcpServers` entirely and return a short success message indicating the integration is always-loaded. When the requested integration is in the baseline but is NOT reported as `connected`, the tool SHALL fall through to a real attach as graceful recovery.

When the unified resolver returns a server config (from either source), the tool SHALL call `setMcpServers(baseline ∪ attached ∪ {name})` and the server's tools become available on the next turn. When the resolver returns nothing AND the registry entry exists (genuine instructions-only entry — e.g., a `data/config.json` entry without an `mcp.json` server AND without a plugin-registered server), the tool SHALL skip `setMcpServers` and return only the topic instructions.

#### Scenario: Successful attach brings tools and instructions (external MCP-backed)

- **GIVEN** Claude is in a query-mode session with only always-on servers attached
- **AND** the registry has `metabase = { alwaysLoad: false, description: "..." }` and `data/mcp.json` has a `metabase` server
- **WHEN** Claude calls `attach_integration({ name: "metabase" })`
- **THEN** the SDK's `setMcpServers` is called with the union of currently-attached servers and `metabase`
- **AND** the tool's text result SHALL begin with the literal string `Attached integration: metabase.` followed by the concatenated contents of `{role}/topics/metabase/*.md` resolved through the cascade
- **AND** when the topic folder contains multiple files (e.g., `metabase.md` and `company-dashboards.md`), all files are concatenated in alphabetical filename order under a single topic header; no per-file header is emitted
- **AND** the Metabase MCP tools (e.g., `mcp__metabase__*`) become available for Claude's next turn

#### Scenario: Successful attach brings tools and instructions (plugin-registered)

- **GIVEN** Claude is in a query-mode session with only always-on servers attached
- **AND** the trivia plugin has called `sdk.registerMcpServer("management", { autoload: false, description: "..." })` and bound tools `upsertSeason`, `upsertGame` etc. via the returned handle
- **AND** the effective registry contains `trivia:management = { alwaysLoad: false, description: "..." }`
- **AND** `data/mcp.json` has no `trivia:management` entry
- **WHEN** Claude calls `attach_integration({ name: "trivia:management" })`
- **THEN** `loadMcpServer("trivia:management")` returns undefined, then `McpServerManager.getPluginServer("trivia:management")` returns the SDK server config built from the plugin's handle
- **AND** the SDK's `setMcpServers` is called with the union of currently-attached servers and the plugin's `trivia:management` server
- **AND** the tools (e.g., `mcp__trivia_management__upsert_season`) become available for Claude's next turn
- **AND** `session.attachedIntegrations` records `"trivia:management"`
- **AND** `mcpAttachHistory` records `outcome: "ok"` (NOT `"instructions_only"`, because tools were attached)

#### Scenario: Duplicate attach is idempotent

- **GIVEN** `metabase` is already attached in the current session
- **WHEN** Claude calls `attach_integration({ name: "metabase" })` again
- **THEN** the tool returns a success result with text `"Integration already attached: metabase. No additional action taken."`
- **AND** topic instructions are NOT re-injected (no duplicate content in the conversation)
- **AND** `setMcpServers` is NOT called

#### Scenario: Baseline-loaded integration short-circuits when SDK reports it connected

- **GIVEN** the registry has `mongodb-prod = { alwaysLoad: true, description: "..." }`
- **AND** the session-start baseline includes `mongodb-prod`
- **AND** the SDK's `Query.mcpServerStatus()` reports `mongodb-prod` with `status: "connected"`
- **WHEN** Claude calls `attach_integration({ name: "mongodb-prod" })`
- **THEN** the tool returns a success result whose text indicates the integration is always-loaded and its tools are already available (e.g. `"Integration mongodb-prod is always-loaded as part of the session baseline — its tools are already available. No attach needed; proceed using the integration's tools directly."`)
- **AND** `setMcpServers` is NOT called
- **AND** topic instructions are NOT re-injected
- **AND** the attempt is recorded in `session.mcpAttachHistory` with `outcome: "duplicate"`

#### Scenario: Baseline-loaded integration falls through to real attach when not connected

- **GIVEN** the registry has `mongodb-prod = { alwaysLoad: true, description: "..." }`
- **AND** the session-start baseline includes `mongodb-prod`
- **AND** the SDK's `Query.mcpServerStatus()` reports `mongodb-prod` with `status` other than `"connected"` (e.g. `"failed"`, `"pending"`, `"needs-auth"`, `"disabled"`), or `mongodb-prod` is absent from the status list, or the status probe throws
- **WHEN** Claude calls `attach_integration({ name: "mongodb-prod" })`
- **THEN** the tool falls through to a real attach: the unified resolver is called and `setMcpServers` is invoked with the baseline + dynamic + `mongodb-prod` union
- **AND** the resulting outcome (success or failure) is reported and persisted using the existing real-attach paths

#### Scenario: Unknown integration name

- **GIVEN** the registry has no entry named `frobnicator`
- **WHEN** Claude calls `attach_integration({ name: "frobnicator" })`
- **THEN** the tool returns an error result with text of the form `Unknown integration: frobnicator. Available integrations: <comma-separated list of all registry entry names, alphabetical>.`
- **AND** `setMcpServers` is NOT called
- **AND** the list includes every registry entry (both always-on and lazy) so Claude can see the full surface area

#### Scenario: Instructions-only integration (no server in either source)

- **GIVEN** the registry has `scheduling = { alwaysLoad: false, description: "..." }`
- **AND** `data/mcp.json` has no `scheduling` entry
- **AND** no plugin has called `sdk.registerMcpServer(...)` that resolves to `scheduling`
- **WHEN** Claude calls `attach_integration({ name: "scheduling" })`
- **THEN** the unified resolver returns undefined from both sources
- **AND** `setMcpServers` is NOT called
- **AND** the tool returns a success result with the topic instructions from `{role}/topics/scheduling/*.md`
- **AND** `session.attachedIntegrations` records `scheduling`
- **AND** `mcpAttachHistory` records `outcome: "instructions_only"`

#### Scenario: MCP connection failure during attach

- **GIVEN** `attach_integration("monday")` is called and the Monday MCP fails to connect (e.g., expired token)
- **WHEN** `setMcpServers` returns `{ errors: { monday: "auth failed" }, ... }`
- **THEN** the tool returns an error result containing the connection error text
- **AND** `session.attachedIntegrations` does NOT record `monday`
- **AND** a thinking-indicator update reports the failure
