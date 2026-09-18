## MODIFIED Requirements

### Requirement: Always-On Subset at Session Start

The system SHALL attach at the start of a new SDK session only the `alwaysLoad: true` MCP servers plus the servers named by the session's pre-attached topics (see "Pre-Attached Topic Servers at Session Start"). Every other non-always-on server SHALL NOT be attached until `attach_integration` is called.

#### Scenario: New session attaches only always-on servers

- **GIVEN** the registry has `clack` and `github` as `alwaysLoad: true` and 7 other servers as `alwaysLoad: false`
- **AND** the session has no pre-attached topic naming any of those 7 servers
- **WHEN** a new query session starts (reactions, mentions, DM, autoRespond, or scheduled)
- **THEN** the SDK's `mcpServers` option contains only `clack` and `github`
- **AND** none of the other 7 servers' tool schemas appear in the session's initial context

#### Scenario: Baseline token cost measurement

- **GIVEN** a reference query of the category "codebase question requiring no external MCP" (captured against the pre-change implementation, recorded in `openspec/changes/add-lazy-mcp-loading/` for reference)
- **WHEN** the same query runs against the post-change implementation (always-on subset only; no `attach_integration` calls)
- **THEN** the initial turn's `cache_creation_input_tokens` is at least 50% lower than the recorded pre-change value
- **AND** both values are documented in the change folder so reviewers can audit the comparison

## ADDED Requirements

### Requirement: Pre-Attached Topic Servers at Session Start

When a session's pre-attached topics include a name that resolves to an MCP server, the system SHALL include that server in the SDK's `mcpServers` option at session start, so its tools are part of the first turn's tool list and no `setMcpServers` call is made for it. Resolution SHALL cover both server sources: external `data/mcp.json` entries present in the effective registry (via `loadMcpServer`), and plugin-registered on-demand servers (`sdk.registerMcpServer(name, { autoload: false })`, matched by their `<plugin>:<name>` integration name). A pre-attached name with no server behind it SHALL load instructions only. A pre-attached name already carried by the session's resumed attachments, or already among the always-on servers, SHALL NOT be loaded a second time. Identical pre-attached topic lists SHALL yield an identical `mcpServers` order across sessions: external servers are merged in topic-list order after the always-on externals and before the clack and plugin servers; plugin on-demand servers keep their place among the plugin servers.

A pre-attached server whose config fails to load SHALL be logged and skipped without failing session start.

`attach_integration` called with a pre-attached name SHALL make no `setMcpServers` call and SHALL NOT re-inject the topic's instructions, and its result SHALL state that the instructions are already in the system prompt and any tools the integration provides are already loaded. The single exception is a name that resolves to an external `data/mcp.json` server the session lacks — its pre-load failed, or the SDK does not report its session-start connection as `connected`: the tool SHALL perform a real attach as recovery, loading the server config once and returning the tools-registered note without the topic instructions. A config load that throws during recovery SHALL be reported as a failed attach.

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

#### Scenario: attach_integration on a pre-attached, loaded server is a no-op

- **GIVEN** a session that pre-attached `metabase` and loaded its server at session start
- **WHEN** Claude calls `attach_integration({ name: "metabase" })`
- **THEN** no `setMcpServers` call is made
- **AND** the result states the instructions are already in the system prompt and any tools it provides are already loaded
- **AND** the topic instructions are not repeated in the result

#### Scenario: attach_integration on a pre-attached plugin on-demand server is a no-op

- **GIVEN** a session that pre-attached `trivia:management`, whose on-demand server loaded with the session
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
- **THEN** the tool performs a real attach via `setMcpServers`
- **AND** the result carries the tools-registered note without the topic instructions
- **WHEN** Claude calls `attach_integration({ name: "metabase" })` again
- **THEN** no further `setMcpServers` call is made

#### Scenario: Pre-attached server whose connection is not live recovers through attach_integration

- **GIVEN** a session that pre-attached `metabase` and loaded it at session start
- **AND** the SDK reports `metabase` as `failed`
- **WHEN** Claude calls `attach_integration({ name: "metabase" })`
- **THEN** the tool performs a real attach via `setMcpServers`
- **AND** the result carries the tools-registered note without the topic instructions
