# clack-plugins Specification

## Purpose
Plugin architecture providing a plugin SDK and runtime for extending Clack with modular functionality, each plugin owning its own MCP server namespace, tool mappings, and persistent data storage.
## Requirements
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

### Requirement: Plugin Tool Mapping Supports Hidden Flag

The `ToolEntryObject` form of a plugin tool mapping SHALL support an optional `hidden: boolean` field. When `true`, the tool's invocations SHALL be suppressed from the Slack streaming task-card UI while still executing server-side normally.

This SHALL be plumbed into the existing streaming hidden-tools mechanism: tools whose mapping specifies `hidden: true` are merged into the resolved hidden list at tool-mapping load time.

#### Scenario: Plugin registers a hidden tool

- **WHEN** a plugin calls `sdk.registerTool("member", toolDef, { label: "…", hidden: true })`
- **THEN** the tool is registered and callable
- **AND** invocations of the tool do not render a task card in the Slack streaming UI

#### Scenario: Hidden flag is optional

- **WHEN** a plugin calls `sdk.registerTool("member", toolDef, "Some label")` or passes an object without `hidden`
- **THEN** the tool behaves as a visible tool (current behavior unchanged)

#### Scenario: Hidden tool still records a ToolCallRecorder entry

- **WHEN** a hidden tool is invoked
- **THEN** the session's `ToolCallRecorder` still captures the call
- **AND** the entry is available via session-transcript tools such as `find_sessions`

### Requirement: No Plugin-vs-Plugin Name Collision

Because each plugin owns its own MCP server namespace, the system SHALL NOT reject or warn about duplicate tool names across plugins.

#### Scenario: Two plugins register a tool with the same name

- **WHEN** plugin `alpha` and plugin `beta` each register a tool named `status`
- **THEN** both tools load successfully
- **AND** Claude sees them as `mcp__alpha__status` and `mcp__beta__status`
- **AND** no warning about duplication is logged

### Requirement: Plugin Contract

A Clack plugin SHALL be a function that receives a `ClackSdk` instance and uses it to register instructions and tools.

#### Scenario: Plugin function signature
- **WHEN** a plugin is defined
- **THEN** it is an async function accepting a single `ClackSdk` parameter
- **AND** it returns `Promise<void>`

#### Scenario: Plugin registers instructions
- **WHEN** a plugin function is called with an SDK instance
- **THEN** the plugin MAY call `sdk.addInstruction(role, filename, content)` one or more times
- **AND** each call declares a virtual instruction file for the given role tier

#### Scenario: Plugin registers tools
- **WHEN** a plugin function is called with an SDK instance
- **THEN** the plugin MAY call `sdk.registerTool(minRole, toolDefinition)` one or more times
- **AND** each call declares a tool with a minimum role requirement

### Requirement: ClackSdk Interface

The system SHALL provide a `ClackSdk` interface with methods for instruction registration, tool registration, and scoped file I/O.

#### Scenario: addInstruction method
- **WHEN** a plugin calls `sdk.addInstruction("user", "instructions", content)`
- **THEN** the SDK stores the content as a virtual default file
- **AND** the filename is automatically prefixed with the plugin name and double underscore (e.g., `trivia__instructions.md`)
- **AND** the plugin does not need to know about the prefix convention

#### Scenario: registerTool method
- **WHEN** a plugin calls `sdk.registerTool("dev", toolDefinition)`
- **THEN** the SDK records the tool with its minimum role requirement
- **AND** the tool is only included in queries where the user's role meets or exceeds the minimum

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

### Requirement: Built-in Plugin Registry

The system SHALL maintain a registry mapping plugin names to their entry functions for built-in plugins.

#### Scenario: Registry lookup for known plugin
- **WHEN** the system loads plugins from config
- **AND** `plugins: ["trivia"]` is configured
- **THEN** the system looks up "trivia" in the built-in registry
- **AND** finds the corresponding plugin function

#### Scenario: Unknown plugin name
- **WHEN** the system loads plugins from config
- **AND** the configured name does not exist in the registry
- **THEN** the system logs a warning
- **AND** skips the unknown plugin without crashing

### Requirement: Plugin Loading Lifecycle

The system SHALL load plugins once at startup, harvesting their registrations for use during queries.

#### Scenario: Plugin loaded at startup
- **WHEN** the application starts
- **THEN** the system reads `plugins` from config
- **AND** for each enabled plugin, creates a scoped `ClackSdk` instance
- **AND** calls the plugin function
- **AND** collects the accumulated instructions and tools

#### Scenario: Plugin error does not crash startup
- **WHEN** a plugin function throws an error during loading
- **THEN** the system catches the error
- **AND** logs it with the plugin name
- **AND** continues loading remaining plugins

#### Scenario: SDK instance persists for data access
- **WHEN** a plugin has been loaded
- **THEN** the `sdk.readFile` and `sdk.writeFile` references captured in tool closures remain usable
- **AND** tool handlers can read and write plugin data throughout the application's lifetime

### Requirement: Config-Driven Activation

The system SHALL use a `plugins` array in `config.json` to control which plugins are active.

#### Scenario: Plugins field in config
- **WHEN** `config.json` contains `"plugins": ["trivia"]`
- **THEN** only the "trivia" plugin is loaded
- **AND** plugins not in the array are not loaded

#### Scenario: Empty or missing plugins field
- **WHEN** `config.json` does not contain a `plugins` field or it is an empty array
- **THEN** no plugins are loaded
- **AND** the system operates normally without plugin functionality

### Requirement: Skill-Plugins Directory Rename

The system SHALL rename `data/plugins/` (Claude Code SDK skill packs) to `data/skill-plugins/` to free the path for Clack plugin data.

#### Scenario: Migration renames directory
- **WHEN** the boot migration runs
- **AND** `data/plugins/` exists
- **AND** `data/skill-plugins/` does not exist
- **THEN** the migration renames `data/plugins/` to `data/skill-plugins/`

#### Scenario: Migration skips if already renamed
- **WHEN** the boot migration runs
- **AND** `data/skill-plugins/` already exists
- **THEN** the migration does nothing

#### Scenario: All SDK plugin references updated
- **WHEN** the migration completes
- **THEN** `discoverPluginInfo()` scans `data/skill-plugins/` instead of `data/plugins/`
- **AND** `discoverPlugins()` returns configs pointing to `data/skill-plugins/` paths
- **AND** the Home Tab displays skill packs under the label "Skill Plugins:" (renamed from "Plugins:")

### Requirement: Home Tab Plugin Display

The Home Tab SHALL display loaded Clack plugins separately from SDK skill packs.

#### Scenario: Clack plugins shown when loaded
- **WHEN** one or more Clack plugins are loaded (e.g., `plugins: ["trivia"]`)
- **THEN** the Home Tab displays a "Plugins:" section
- **AND** each plugin is listed with its name and the number of tools it registered

#### Scenario: Clack plugins section hidden when none loaded
- **WHEN** no Clack plugins are configured or loaded
- **THEN** the Home Tab does NOT display the "Plugins:" section

#### Scenario: Both sections shown independently
- **WHEN** both SDK skill packs exist in `data/skill-plugins/` and Clack plugins are loaded
- **THEN** the Home Tab displays both "Skill Plugins:" and "Plugins:" as separate sections

### Requirement: ClackSdk Exposes Cron Reconciliation

The `ClackSdk` interface SHALL include a `reconcileCronJobs(ownerKey: string, specs: CronJobSpec[]): Promise<void>` method. Plugins use this method during init to declare the cron jobs they want to own. Detailed semantics, identity rules, and admin-override behavior are codified in the `plugin-cron-reconciliation` capability — this requirement only governs the SDK surface.

#### Scenario: SDK method is present on every plugin's SDK instance

- **WHEN** the system creates a `ClackSdk` instance for a plugin during loading
- **THEN** the instance exposes a `reconcileCronJobs` function with the documented signature

#### Scenario: Calling without arguments validates loudly

- **WHEN** a plugin calls `sdk.reconcileCronJobs()` (no args) or with a non-string `ownerKey` or non-array `specs`
- **THEN** the call rejects with a descriptive error
- **AND** no persisted state is touched

### Requirement: ClackSdk Exposes File Watching

The `ClackSdk` interface SHALL include a `watchFile(relativePath: string, callback: () => void): FSWatcher` method. Paths resolve under the plugin's data directory; watchers are torn down on plugin reload. Detailed semantics are codified in the `plugin-file-watch` capability — this requirement only governs the SDK surface.

#### Scenario: SDK method is present on every plugin's SDK instance

- **WHEN** the system creates a `ClackSdk` instance for a plugin during loading
- **THEN** the instance exposes a `watchFile` function with the documented signature

#### Scenario: Watcher is tracked for teardown

- **WHEN** a plugin calls `sdk.watchFile(...)` and receives back an `FSWatcher`
- **THEN** the plugin loader records the watcher in the plugin's load result
- **AND** the watcher is closed when `restartAll()` reloads plugins (before the new init runs)

### Requirement: Plugin SDK Single-Turn Claude Call

The Clack plugin SDK SHALL expose `sdk.askClaude(opts)` allowing a plugin to invoke a single-turn Claude API call (Anthropic SDK's `messages.create`) without instantiating its own Anthropic client or managing credentials. `opts` SHALL accept at minimum: `model: string` (a Claude model id, e.g. `"claude-haiku-4-5-20251001"`), `system?: string`, `messages: Array<{ role: "user" | "assistant"; content: string }>`, `max_tokens: number`, and OPTIONAL `temperature: number`. The SDK SHALL return the first content block of the response as `{ text: string; stopReason: string; usage: { inputTokens: number; outputTokens: number } }`. The credential SHALL be the same `ANTHROPIC_API_KEY` already used by the Claude Agent SDK; no new env var is introduced.

#### Scenario: Plugin invokes a single-turn Claude call

- **WHEN** a plugin calls `sdk.askClaude({ model: "claude-haiku-4-5-20251001", messages: [{ role: "user", content: "Hello" }], max_tokens: 100 })`
- **THEN** the SDK invokes the Anthropic SDK's `messages.create` with the supplied parameters using the existing `ANTHROPIC_API_KEY`
- **AND** returns the response's first content block as `{ text, stopReason, usage }`

#### Scenario: Missing credential surfaces a clear error

- **WHEN** `sdk.askClaude` is called and `ANTHROPIC_API_KEY` is not configured
- **THEN** the SDK throws an error indicating the API key is missing
- **AND** does not silently return an empty response

#### Scenario: Errors from the Anthropic API are propagated

- **WHEN** the underlying Anthropic SDK rejects (e.g. rate limit, invalid model)
- **THEN** the error is re-thrown unchanged
- **AND** the caller can inspect the error type and retry / fall back as appropriate

### Requirement: ClackSdk Posting Helpers Accept suppressUnfurls

Every plugin SDK helper that posts a Slack message (currently `dmOwner`, and any future helpers added that wrap `chat.postMessage`) SHALL accept an optional `suppressUnfurls: boolean` parameter. When `true`, the underlying `chat.postMessage` call SHALL include `unfurl_links: false` and `unfurl_media: false`. When absent or `false`, the call SHALL NOT include those keys.

#### Scenario: dmOwner with suppressUnfurls true

- **WHEN** a plugin calls `sdk.dmOwner(text, { suppressUnfurls: true })`
- **THEN** the resulting `chat.postMessage` call contains `unfurl_links: false`
- **AND** contains `unfurl_media: false`

#### Scenario: dmOwner without suppressUnfurls

- **WHEN** a plugin calls `sdk.dmOwner(text)` with no options
- **THEN** the resulting `chat.postMessage` call does NOT contain `unfurl_links`
- **AND** does NOT contain `unfurl_media`
- **AND** Slack's default unfurling applies

#### Scenario: Future posting helpers honor the same contract

- **GIVEN** the plugin SDK gains a new posting helper that wraps `chat.postMessage`
- **WHEN** the helper is added
- **THEN** it SHALL accept the same optional `suppressUnfurls: boolean` parameter
- **AND** route the value through the shared suppress-unfurls helper defined in `link-unfurl-control`
