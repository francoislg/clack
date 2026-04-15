## ADDED Requirements

### Requirement: Per-Plugin MCP Server Namespace

Each loaded Clack plugin SHALL be exposed to Claude as its own in-process MCP server, named after the plugin. Plugin tools SHALL NOT share the `clack` core MCP server.

#### Scenario: Plugin owns its own MCP server

- **WHEN** a plugin named `trivia` registers tools via `sdk.registerTool(...)`
- **THEN** during query tool assembly the system creates a dedicated `createSdkMcpServer({ name: "trivia", ... })` containing only that plugin's tools
- **AND** Claude sees those tools as `mcp__trivia__<toolName>`
- **AND** no plugin tool appears under the `mcp__clack__` prefix

#### Scenario: Multiple plugins each get their own server

- **WHEN** two plugins `trivia` and `weather` are both loaded
- **THEN** the tool assembly produces two plugin MCP servers (`trivia`, `weather`) in addition to the `clack` core server
- **AND** tools in one plugin's server cannot collide by name with tools in another plugin's server

#### Scenario: Plugin name `clack` is reserved

- **WHEN** a plugin declares its name as `clack` in the built-in registry
- **THEN** the system logs a warning
- **AND** skips loading that plugin
- **AND** does not overwrite the core `clack` MCP server

### Requirement: Plugin Load Result Exposes MCP Server

The `PluginLoadResult` returned by plugin loading SHALL include the plugin's MCP server instance so that downstream Agent SDK invocations can pass it alongside the `clack` core server.

#### Scenario: Load result carries mcpServer

- **WHEN** the plugin loader finishes loading a plugin
- **THEN** the returned `PluginLoadResult` contains an `mcpServer` field referencing that plugin's `createSdkMcpServer` instance
- **AND** callers assembling the Agent SDK `mcpServers` record spread all plugin servers alongside `clack`

### Requirement: Transparent Tool Call Recording for Plugin Tools

The plugin integration layer SHALL ensure every plugin tool invocation is recorded by the per-session `ToolCallRecorder` without requiring plugin authors to opt in.

#### Scenario: Plugin tool handler wrapped at assembly time

- **WHEN** query tool assembly consumes a registered plugin tool
- **THEN** the system wraps the tool's handler so that each invocation records an entry with `tool` set to the full MCP-visible name (`mcp__<plugin>__<tool>`), the args, and the result
- **AND** the plugin author does not call any recorder API themselves
- **AND** the original handler's return value is forwarded unchanged to Claude

#### Scenario: Handler errors are recorded and rethrown

- **WHEN** a plugin tool handler throws an exception
- **THEN** the wrapper records an entry with an error outcome and the original args
- **AND** rethrows the exception so the Agent SDK sees the original error

### Requirement: Plugin-Declared Default Required Tools for Scheduled Runs

Plugins SHALL be able to declare a list of bare tool names that scheduled runs linked to the plugin must invoke. The declared names are prefixed to their full MCP form (`mcp__<plugin>__<tool>`) and merged into the effective `requiredTools` list at trigger time.

#### Scenario: SDK exposes `requireToolsForScheduled`

- **WHEN** a plugin calls `sdk.requireToolsForScheduled(["submit_answers"])`
- **THEN** the SDK stores the list on the plugin load result
- **AND** the list is exposed on `PluginLoadResult.scheduledRequiredTools` (or equivalent field)

#### Scenario: Declared defaults applied when cron job links to the plugin

- **GIVEN** plugin `trivia` declared `requireToolsForScheduled(["submit_answers"])`
- **AND** a cron job has `plugin: "trivia"` (no explicit `requiredTools`)
- **WHEN** the cron fires
- **THEN** the effective `requiredTools` passed to `processMessage` includes `mcp__trivia__submit_answers`

#### Scenario: Explicit `requiredTools` unions with plugin defaults

- **GIVEN** plugin `trivia` declared `requireToolsForScheduled(["submit_answers"])`
- **AND** a cron job has `plugin: "trivia"` and `requiredTools: ["mcp__trivia__save_question"]`
- **WHEN** the cron fires
- **THEN** the effective `requiredTools` includes BOTH `mcp__trivia__submit_answers` AND `mcp__trivia__save_question`
- **AND** duplicates are deduplicated

#### Scenario: Defaults do not apply when cron has no plugin link

- **GIVEN** plugin `trivia` declared `requireToolsForScheduled(["submit_answers"])`
- **AND** a cron job does NOT set the `plugin` field
- **WHEN** the cron fires
- **THEN** `mcp__trivia__submit_answers` is NOT added to the effective `requiredTools`
- **AND** trivia's declaration does not leak into the job

#### Scenario: Unknown plugin name in cron job

- **GIVEN** a cron job has `plugin: "not-loaded"` (no such plugin is active)
- **WHEN** the cron fires
- **THEN** no plugin defaults are applied (the job runs with only its explicit `requiredTools`, if any)
- **AND** the system logs a warning identifying the unknown plugin name

### Requirement: No Plugin-vs-Plugin Name Collision

Because each plugin owns its own MCP server namespace, the system SHALL NOT reject or warn about duplicate tool names across plugins.

#### Scenario: Two plugins register a tool with the same name

- **WHEN** plugin `alpha` and plugin `beta` each register a tool named `status`
- **THEN** both tools load successfully
- **AND** Claude sees them as `mcp__alpha__status` and `mcp__beta__status`
- **AND** no warning about duplication is logged
