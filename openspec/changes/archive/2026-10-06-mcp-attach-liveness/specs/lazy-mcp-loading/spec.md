## MODIFIED Requirements

### Requirement: `attach_integration` Tool

The system SHALL expose an internal tool `attach_integration(name: string)` to Claude that dynamically attaches an MCP server and returns its topic instructions. The tool SHALL be available in query-mode sessions (reactions, DMs, mentions, autoRespond, threadReply, scheduled) and hidden in worker-mode. The tool SHALL resolve the requested name through a single unified resolver: first via `loadMcpServer(name)` (external `data/mcp.json` entries), then via the per-session plugin-registered server registry on `McpServerManager` (servers declared by plugins via `sdk.registerMcpServer`).

The tool SHALL report a server as attached, registered, or loaded only when the SDK's `Query.mcpServerStatus()` reports it `connected` after the attach. Registration alone SHALL NOT count: a server registered with the SDK (session-start baseline, a previous attach, or a resumed attachment) that is not `connected` SHALL NOT be reported as attached or loaded.

The tool SHALL be idempotent against both the dynamically-attached set AND the session-start baseline, judged by live status: when the requested server is registered and the SDK reports it `connected`, the tool SHALL make no `setMcpServers` or reconnect call and return a short success message (the always-loaded message for a baseline server, the already-attached message for a dynamic one). When a registered server is not `connected`, the tool SHALL attempt recovery according to its status:

- `failed` — the tool SHALL call the SDK's `reconnectMcpServer(name)`. Re-sending an unchanged config through `setMcpServers` SHALL NOT be used as the retry.
- `pending` — the tool SHALL re-read the status at a fixed interval for a bounded time (about 5 seconds) and treat a server still `pending` afterwards as a retryable failure; a server that settles into another status SHALL be handled as that status (a server that settles `failed` is reconnected).
- `needs-auth` or `disabled` — the tool SHALL fail without a retry and mark the failure not retryable.

A server absent from the SDK's status list SHALL be attached through `setMcpServers(baseline ∪ attached ∪ {name})`. After any `setMcpServers` or reconnect call, the tool SHALL read the status again (settling `pending` as above): `connected` succeeds; any other status fails, and the server SHALL NOT be recorded as attached in the manager or in `session.attachedIntegrations`.

A failure result SHALL name the server's status and the SDK's error text, and SHALL state whether calling `attach_integration` again may help (retryable: `failed` including connect timeouts, still `pending`, a `setMcpServers` error for the name, a thrown reconnect) or will not help (`needs-auth`, `disabled`), in which case Claude is told to stop using the integration and tell the user it is unavailable.

When `mcpServerStatus()` throws or is not bound, the status is unknown and the tool SHALL fall back to the result of the SDK call it makes. When the status read before acting is unknown, a registered server SHALL succeed without a call, and an unregistered server SHALL be attached through `setMcpServers` and succeed when it reports no error for the name. When the read before acting worked but the read after acting is unknown, `setMcpServers` with no error for the name SHALL succeed and a `reconnectMcpServer` that resolved SHALL succeed. Each fallback SHALL log a warning.

When an attach succeeds with a server config (from either source), the server's tools are available within the SAME turn — they land in the searchable tool pool, so Claude surfaces them via `ToolSearch` and calls them without ending its turn. The tool result text SHALL instruct Claude to continue in-turn rather than waiting for a "next turn". When the resolver returns nothing AND the registry entry exists (genuine instructions-only entry — e.g., a `data/config.json` entry without an `mcp.json` server AND without a plugin-registered server), the tool SHALL skip `setMcpServers` and return only the topic instructions.

#### Scenario: Successful attach brings tools and instructions (external MCP-backed)

- **GIVEN** Claude is in a query-mode session with only always-on servers attached
- **AND** the registry has `metabase = { alwaysLoad: false, description: "..." }` and `data/mcp.json` has a `metabase` server
- **WHEN** Claude calls `attach_integration({ name: "metabase" })`
- **AND** after `setMcpServers` the SDK reports `metabase` as `connected`
- **THEN** the SDK's `setMcpServers` is called with the union of currently-attached servers and `metabase`
- **AND** the tool's text result SHALL begin with the literal string `Attached integration: metabase.` followed by the concatenated contents of `{role}/topics/metabase/*.md` resolved through the cascade
- **AND** when the topic folder contains multiple files (e.g., `metabase.md` and `company-dashboards.md`), all files are concatenated in alphabetical filename order under a single topic header; no per-file header is emitted
- **AND** the Metabase MCP tools (e.g., `mcp__metabase__*`) become available to Claude within the same turn (surfaced via `ToolSearch`)

#### Scenario: Successful attach brings tools and instructions (plugin-registered)

- **GIVEN** Claude is in a query-mode session with only always-on servers attached
- **AND** the trivia plugin has called `sdk.registerMcpServer("management", { autoload: false, description: "..." })` and bound tools `upsertSeason`, `upsertGame` etc. via the returned handle
- **AND** the effective registry contains `trivia:management = { alwaysLoad: false, description: "..." }`
- **AND** `data/mcp.json` has no `trivia:management` entry
- **WHEN** Claude calls `attach_integration({ name: "trivia:management" })`
- **AND** after `setMcpServers` the SDK reports `trivia:management` as `connected`
- **THEN** `loadMcpServer("trivia:management")` returns undefined, then `McpServerManager.getIntegrationServer("trivia:management")` returns the SDK server config built from the plugin's handle
- **AND** the SDK's `setMcpServers` is called with the union of currently-attached servers and the plugin's `trivia:management` server
- **AND** the tools (e.g., `mcp__trivia_management__upsert_season`) become available to Claude within the same turn (surfaced via `ToolSearch`)
- **AND** `session.attachedIntegrations` records `"trivia:management"`
- **AND** `mcpAttachHistory` records `outcome: "ok"` (NOT `"instructions_only"`, because tools were attached)

#### Scenario: Duplicate attach is idempotent

- **GIVEN** `metabase` is already attached in the current session
- **AND** the SDK reports `metabase` as `connected`
- **WHEN** Claude calls `attach_integration({ name: "metabase" })` again
- **THEN** the tool returns a success result with text `"Integration already attached: metabase. No additional action taken."`
- **AND** topic instructions are NOT re-injected (no duplicate content in the conversation)
- **AND** neither `setMcpServers` nor `reconnectMcpServer` is called

#### Scenario: Duplicate attach of a server that dropped reconnects it

- **GIVEN** `metabase` is already attached in the current session
- **AND** the SDK now reports `metabase` as `failed`
- **WHEN** Claude calls `attach_integration({ name: "metabase" })` again
- **THEN** `reconnectMcpServer("metabase")` is called and `setMcpServers` is NOT called
- **AND** when the SDK then reports `metabase` as `connected`, the tool returns the tools-registered note without re-injecting the topic instructions
- **AND** when the SDK still reports `metabase` as not `connected`, the tool returns a failure naming the status

#### Scenario: Baseline-loaded integration short-circuits when SDK reports it connected

- **GIVEN** the registry has `mongodb-prod = { alwaysLoad: true, description: "..." }`
- **AND** the session-start baseline includes `mongodb-prod`
- **AND** the SDK's `Query.mcpServerStatus()` reports `mongodb-prod` with `status: "connected"`
- **WHEN** Claude calls `attach_integration({ name: "mongodb-prod" })`
- **THEN** the tool returns a success result whose text indicates the integration is always-loaded and its tools are already available (e.g. `"Integration mongodb-prod is always-loaded as part of the session baseline — its tools are already available. No attach needed; proceed using the integration's tools directly."`)
- **AND** neither `setMcpServers` nor `reconnectMcpServer` is called
- **AND** topic instructions are NOT re-injected
- **AND** the attempt is recorded in `session.mcpAttachHistory` with `outcome: "duplicate"`

#### Scenario: Baseline-loaded integration reconnects when it failed

- **GIVEN** the registry has `mongodb-prod = { alwaysLoad: true, description: "..." }`
- **AND** the session-start baseline includes `mongodb-prod`
- **AND** the SDK's `Query.mcpServerStatus()` reports `mongodb-prod` with `status: "failed"`
- **WHEN** Claude calls `attach_integration({ name: "mongodb-prod" })`
- **THEN** the tool calls `reconnectMcpServer("mongodb-prod")` and does NOT call `setMcpServers`
- **AND** the resulting outcome (success only when the SDK then reports `connected`, failure otherwise) is reported and persisted using the real-attach paths

#### Scenario: Pending server settles before the result

- **GIVEN** Claude calls `attach_integration({ name: "metabase" })`
- **AND** after `setMcpServers` the SDK reports `metabase` as `pending`
- **WHEN** a later status read within the bounded wait reports `connected`
- **THEN** the tool succeeds
- **WHEN** instead every status read within the bounded wait reports `pending`
- **THEN** the tool returns a failure naming the `pending` status and stating that retrying may help
- **AND** `metabase` is not recorded as attached

#### Scenario: Server that needs auth fails without a retry

- **GIVEN** the SDK reports `monday` as `needs-auth`
- **WHEN** Claude calls `attach_integration({ name: "monday" })`
- **THEN** neither `setMcpServers` nor `reconnectMcpServer` is called
- **AND** the tool returns a failure naming the `needs-auth` status and stating that retrying will not help and the user should be told the integration is unavailable

#### Scenario: Status read failure falls back to the SDK call's result

- **GIVEN** `Query.mcpServerStatus()` throws
- **WHEN** Claude calls `attach_integration({ name: "metabase" })` for an unregistered `metabase`
- **AND** `setMcpServers` reports no error for `metabase`
- **THEN** the tool succeeds and records `metabase` as attached
- **AND** a warning is logged that the status could not be read
- **WHEN** instead `setMcpServers` reports an error for `metabase`
- **THEN** the tool returns a failure carrying that error and stating that retrying may help

#### Scenario: Status read fails only after a reconnect

- **GIVEN** `metabase` is registered and the SDK reports it as `failed`
- **WHEN** Claude calls `attach_integration({ name: "metabase" })`
- **AND** `reconnectMcpServer("metabase")` resolves
- **AND** the status read after the reconnect throws
- **THEN** the tool succeeds with the tools-registered note
- **AND** a warning is logged that the status could not be read

#### Scenario: Status read failure on a registered server

- **GIVEN** `Query.mcpServerStatus()` throws
- **AND** `metabase` is registered (session start or a previous attach)
- **WHEN** Claude calls `attach_integration({ name: "metabase" })`
- **THEN** neither `setMcpServers` nor `reconnectMcpServer` is called
- **AND** the tool returns the same success message it returns for a connected registered server
- **AND** a warning is logged that the status could not be read

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
- **AND** the SDK then reports `monday` as `failed`
- **THEN** the tool returns an error result of the form `Failed to attach monday: failed: auth failed` followed by the statement that retrying may help
- **AND** when the SDK instead reports `monday` as `needs-auth`, the result names `needs-auth` and states that retrying will not help
- **AND** `session.attachedIntegrations` does NOT record `monday`
- **AND** a thinking-indicator update reports the failure

#### Scenario: Reconnect that throws is a retryable failure

- **GIVEN** `metabase` is registered and the SDK reports it as `failed`
- **WHEN** Claude calls `attach_integration({ name: "metabase" })`
- **AND** `reconnectMcpServer("metabase")` throws
- **THEN** the tool returns a failure carrying the thrown error and stating that retrying may help
- **AND** `metabase` is not reported as attached or loaded

#### Scenario: setMcpServers reports no error but the server is not connected

- **GIVEN** `attach_integration("metabase")` is called for an unregistered `metabase`
- **WHEN** `setMcpServers` returns no error for `metabase`
- **AND** the SDK then reports `metabase` as `failed`
- **THEN** the tool returns a failure naming the `failed` status and stating that retrying may help
- **AND** `metabase` is not recorded as attached in the manager or in `session.attachedIntegrations`
- **AND** a later `attach_integration({ name: "metabase" })` calls `reconnectMcpServer("metabase")` because the SDK lists the server

### Requirement: Pre-Attached Topic Servers at Session Start

When a session's pre-attached topics include a name that resolves to an MCP server, the system SHALL include that server in the SDK's `mcpServers` option at session start, so its tools are part of the first turn's tool list and no `setMcpServers` call is made for it. Resolution SHALL cover both server sources: external `data/mcp.json` entries present in the effective registry (via `loadMcpServer`), and plugin-registered on-demand servers (`sdk.registerMcpServer(name, { autoload: false })`, matched by their `<plugin>:<name>` integration name). A pre-attached name with no server behind it SHALL load instructions only. A pre-attached name already carried by the session's resumed attachments, or already among the always-on servers, SHALL NOT be loaded a second time. Identical pre-attached topic lists SHALL yield an identical `mcpServers` order across sessions: external servers are merged in topic-list order after the always-on externals and before the clack and plugin servers; plugin on-demand servers keep their place among the plugin servers.

A pre-attached server whose config fails to load SHALL be logged and skipped without failing session start.

`attach_integration` called with a pre-attached name SHALL NOT re-inject the topic's instructions. For a pre-attached name with no server behind it, or whose server the SDK reports `connected`, the tool SHALL make no `setMcpServers` or reconnect call, and its result SHALL state that the instructions are already in the system prompt and any tools the integration provides are already loaded. That statement SHALL NOT be made for a server that is not `connected`. A pre-attached server the session lacks or that is not `connected` SHALL be recovered by the `attach_integration` Tool requirement's liveness rules: a server whose pre-load failed is loaded once and attached through `setMcpServers`; a registered server reported `failed` is reconnected through `reconnectMcpServer`; `pending`, `needs-auth`, `disabled`, and the status-read fallback behave as in that requirement. A recovery that ends `connected` SHALL return the tools-registered note without the topic instructions; any other end SHALL return the failure result with its status and retry guidance. A config load that throws during recovery SHALL be reported as a failed attach, with the statement that retrying may help.

#### Scenario: External server named by a pre-attached topic loads with the session

- **GIVEN** the registry has `metabase` as `alwaysLoad: false` with a `data/mcp.json` entry
- **WHEN** a scheduled session starts with pre-attached topics `["response-rendering", "metabase"]`
- **THEN** the SDK's `mcpServers` option contains `metabase` alongside the always-on servers
- **AND** the `metabase` topic instructions are in the system prompt
- **AND** no `setMcpServers` call is made during session start

#### Scenario: Plugin on-demand server named by a pre-attached topic loads with the session

- **GIVEN** a plugin registered an on-demand server with integration name `trivia:management`
- **WHEN** a session starts with pre-attached topics `["trivia:management"]`
- **THEN** the `mcp__trivia_management__*` tools are in the session's tool list from the first turn

#### Scenario: Topic with no server stays instructions-only

- **WHEN** a session starts with pre-attached topics `["response-rendering"]`
- **THEN** the SDK's `mcpServers` option contains only the always-on servers

#### Scenario: Identical topic lists give identical server order

- **GIVEN** the registry has `github` as `alwaysLoad: true`
- **WHEN** two sessions start with pre-attached topics `["response-rendering", "sentry", "metabase"]`
- **THEN** both sessions' `mcpServers` options list `github`, `sentry`, `metabase`, then the clack and plugin servers, in that order

#### Scenario: Pre-attached name already resumed is not loaded twice

- **GIVEN** `session.attachedIntegrations` already contains `metabase` from a prior mid-session attach
- **AND** the session's pre-attached topics also include `metabase`
- **WHEN** the session starts
- **THEN** `loadMcpServer("metabase")` is called once
- **AND** `metabase` appears once in the SDK's `mcpServers` option

#### Scenario: attach_integration on a pre-attached, connected server is a no-op

- **GIVEN** a session that pre-attached `metabase` and loaded its server at session start
- **AND** the SDK reports `metabase` as `connected`
- **WHEN** Claude calls `attach_integration({ name: "metabase" })`
- **THEN** neither `setMcpServers` nor `reconnectMcpServer` is called
- **AND** the result states the instructions are already in the system prompt and any tools it provides are already loaded
- **AND** the topic instructions are not repeated in the result

#### Scenario: attach_integration on a pre-attached plugin on-demand server is a no-op

- **GIVEN** a session that pre-attached `trivia:management`, whose on-demand server loaded with the session
- **AND** the SDK reports `trivia:management` as `connected`
- **WHEN** Claude calls `attach_integration({ name: "trivia:management" })`
- **THEN** no `setMcpServers` call is made

#### Scenario: attach_integration on a pre-attached topic with no server is a no-op

- **GIVEN** a session that pre-attached `response-rendering`
- **WHEN** Claude calls `attach_integration({ name: "response-rendering" })`
- **THEN** no `setMcpServers` call is made
- **AND** the topic instructions are not repeated in the result

#### Scenario: Failed pre-load recovers through attach_integration

- **GIVEN** a session that pre-attached `metabase` but `loadMcpServer("metabase")` threw at session start
- **WHEN** the session starts
- **THEN** a warning is logged and the session runs without `metabase` in `mcpServers`
- **WHEN** Claude then calls `attach_integration({ name: "metabase" })`
- **AND** after `setMcpServers` the SDK reports `metabase` as `connected`
- **THEN** the tool performs a real attach via `setMcpServers`
- **AND** the result carries the tools-registered note without the topic instructions
- **WHEN** Claude calls `attach_integration({ name: "metabase" })` again while the SDK still reports it `connected`
- **THEN** no further `setMcpServers` call is made

#### Scenario: Config load that throws during pre-attached recovery is a failed attach

- **GIVEN** a session that pre-attached `metabase` but `loadMcpServer("metabase")` threw at session start
- **WHEN** Claude calls `attach_integration({ name: "metabase" })`
- **AND** `loadMcpServer("metabase")` throws again
- **THEN** the tool returns a failure result carrying the load error, not an unhandled error
- **AND** neither `setMcpServers` nor `reconnectMcpServer` is called
- **AND** `metabase` is not recorded as attached

#### Scenario: Pre-attached server whose connection failed reconnects through attach_integration

- **GIVEN** a session that pre-attached `metabase` and loaded it at session start
- **AND** the SDK reports `metabase` as `failed`
- **WHEN** Claude calls `attach_integration({ name: "metabase" })`
- **THEN** the tool calls `reconnectMcpServer("metabase")` and does NOT call `setMcpServers`
- **AND** when the SDK then reports `metabase` as `connected`, the result carries the tools-registered note without the topic instructions

#### Scenario: Pre-attached server that stays down is never reported loaded

- **GIVEN** a scheduled session that pre-attached `gcp-observability`, whose session-start connection timed out
- **AND** the SDK reports `gcp-observability` as `failed` throughout
- **WHEN** Claude calls `attach_integration({ name: "gcp-observability" })` repeatedly
- **THEN** every call reconnects through `reconnectMcpServer` and returns a failure naming the `failed` status and the SDK's error, stating that retrying may help
- **AND** no call returns the tools-registered note or the "already loaded" statement
- **AND** `gcp-observability` is never recorded as attached
