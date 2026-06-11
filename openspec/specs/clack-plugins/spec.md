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

### Requirement: ClackSdk Exposes Plugin Error Reporting

The `ClackSdk` interface SHALL expose `error(reason: string): void`. Plugins SHALL call this method during init to record a load-time problem. The call is non-fatal: it appends `reason` to the plugin's `errors[]` array on its `PluginLoadResult` and returns. Plugins MAY call `error()` multiple times to record multiple independent problems, and MAY continue execution after calling it (e.g. to register a partial set of tools), or `return` immediately to abort the load.

#### Scenario: Single error recorded

- **WHEN** a plugin calls `sdk.error("reason text")`
- **THEN** the SDK appends `"reason text"` to that plugin's `errors[]` array
- **AND** does not throw

#### Scenario: Multiple errors accumulate

- **WHEN** a plugin calls `sdk.error("reason A")` followed by `sdk.error("reason B")`
- **THEN** that plugin's `errors[]` contains both strings in call order

#### Scenario: Plugin continues after calling error

- **WHEN** a plugin calls `sdk.error("partial-failure reason")` and then `sdk.registerTool(...)`
- **THEN** the SDK records the error
- **AND** ALSO records the registered tool
- **AND** the plugin's `PluginLoadResult` has `errors.length > 0` AND `tools.length > 0`

### Requirement: ClackSdk Exposes Capability Flags

The `ClackSdk` interface SHALL expose `capabilities: { crons: boolean }`. Each field reflects a static-at-load-time fact about the host runtime. Plugins SHALL use these flags to decide whether they can run. The initial set contains only `crons`, which mirrors `config.cron.enabled` at the time the plugin was loaded.

#### Scenario: capabilities.crons reflects cron.enabled = true

- **GIVEN** `config.cron.enabled` is `true`
- **WHEN** a plugin's init runs
- **THEN** `sdk.capabilities.crons` is `true`

#### Scenario: capabilities.crons reflects cron.enabled = false

- **GIVEN** `config.cron.enabled` is `false`
- **WHEN** a plugin's init runs
- **THEN** `sdk.capabilities.crons` is `false`

#### Scenario: capabilities is a plain object

- **WHEN** a plugin reads `sdk.capabilities`
- **THEN** the value is a plain object with boolean fields (not a function)
- **AND** the object is safe to destructure

### Requirement: PluginLoadResult Includes Errors

The `PluginLoadResult` type SHALL include `errors: string[]`. The array SHALL accumulate every reason passed to `sdk.error()` during the plugin's init call, in call order. When the plugin's init throws an unhandled exception, the loader SHALL push a synthetic `PluginLoadResult` for that plugin with `errors: [<thrown message>]` and empty `instructions`, `tools`, `actionHandlers`, and `viewHandlers` arrays — the plugin is "present but degraded" rather than absent.

#### Scenario: Errors populated from sdk.error calls

- **GIVEN** a plugin's init calls `sdk.error("A")` and `sdk.error("B")`
- **WHEN** loading completes
- **THEN** that plugin's `PluginLoadResult.errors` equals `["A", "B"]`

#### Scenario: Unhandled throw becomes synthetic result

- **GIVEN** a plugin's init throws `new Error("boom")`
- **WHEN** loading completes
- **THEN** the loader appends a `PluginLoadResult` with `name: <plugin-name>`, `errors: ["boom"]`, `instructions: []`, `tools: []`, `actionHandlers: []`, `viewHandlers: []`
- **AND** the failing plugin is NOT silently dropped

#### Scenario: Successful plugin has empty errors

- **GIVEN** a plugin's init runs to completion without calling `sdk.error` and without throwing
- **WHEN** loading completes
- **THEN** that plugin's `PluginLoadResult.errors` is an empty array

### Requirement: Plugin Loading Lifecycle

The system SHALL load plugins once at startup, harvesting their registrations for use during queries. Errors raised intentionally via `sdk.error` or thrown unexpectedly during init SHALL surface on the plugin's `PluginLoadResult.errors`; the plugin is never silently dropped from the loaded set.

#### Scenario: Plugin loaded at startup
- **WHEN** the application starts
- **THEN** the system reads `plugins` from config
- **AND** for each enabled plugin, creates a scoped `ClackSdk` instance
- **AND** calls the plugin function
- **AND** collects the accumulated instructions, tools, and errors

#### Scenario: Plugin error does not crash startup
- **WHEN** a plugin function throws an error during loading
- **THEN** the system catches the error
- **AND** logs it with the plugin name
- **AND** records the thrown message on a synthetic `PluginLoadResult.errors`
- **AND** continues loading remaining plugins

#### Scenario: Plugin calls sdk.error then returns
- **WHEN** a plugin's init calls `sdk.error("reason")` and returns without registering tools
- **THEN** the loader records the error on the plugin's `PluginLoadResult`
- **AND** the plugin appears in the loaded set with `errors.length === 1`
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

### Requirement: Plugin SDK Localization

The `ClackSdk` SHALL expose two methods that let plugin code render user-facing text in the workspace's configured language without violating the plugin import boundary:

- `registerDictionary(dictionaries: { en: Record<string, string>; fr?: Record<string, string> }): void` — register the plugin's translation table. The `en` key is REQUIRED and is the authoritative source-of-truth for the plugin's key space. Other supported languages (initially `fr`) MAY be partial; absent keys fall back to the `en` value at lookup time. Calling `registerDictionary` twice on the same plugin's SDK SHALL replace the prior registration (last-write-wins, useful for hot-reload).
- `t(key: string, vars?: Record<string, string | number>): string` — look up `key` in THIS plugin's registered dictionary against the active workspace language (read from `getConfig().language`, defaulting to `"en"` when unset or unloadable). When `vars` is supplied, every occurrence of `{name}` in the resolved template SHALL be replaced with the stringified value of `vars.name`.

Both methods SHALL be scoped to the calling plugin by the SDK factory's captured `pluginName` — plugin A cannot read or overwrite plugin B's dictionary. The SDK SHALL NOT expose a way to pass the plugin name explicitly.

#### Scenario: Plugin reads its own dictionary

- **GIVEN** a plugin's SDK has registered `{ en: { hello: "Hello" }, fr: { hello: "Bonjour" } }` via `sdk.registerDictionary(...)`
- **AND** `getConfig().language` returns `"fr"`
- **WHEN** the plugin calls `sdk.t("hello")`
- **THEN** the call returns `"Bonjour"`

#### Scenario: Fallback to EN when language key missing

- **GIVEN** a plugin's SDK has registered `{ en: { hello: "Hello", goodbye: "Goodbye" }, fr: { hello: "Bonjour" } }`
- **AND** `getConfig().language` returns `"fr"`
- **WHEN** the plugin calls `sdk.t("goodbye")`
- **THEN** the call returns `"Goodbye"` (the EN value)
- **AND** a one-time warning is logged identifying the plugin and the missing key

#### Scenario: Default to EN when language is unset

- **GIVEN** a plugin's SDK has registered `{ en: { hello: "Hello" }, fr: { hello: "Bonjour" } }`
- **AND** `getConfig()` throws OR returns no `language` field
- **WHEN** the plugin calls `sdk.t("hello")`
- **THEN** the call returns `"Hello"` (the EN value)

#### Scenario: Variable interpolation

- **GIVEN** a plugin's SDK has registered `{ en: { greet: "Hi {name}, you have {n} new messages" } }`
- **WHEN** the plugin calls `sdk.t("greet", { name: "Alice", n: 3 })`
- **THEN** the call returns `"Hi Alice, you have 3 new messages"`

#### Scenario: Missing key throws

- **GIVEN** a plugin's SDK has registered `{ en: { hello: "Hello" } }`
- **WHEN** the plugin calls `sdk.t("nonexistent")`
- **THEN** the call throws an `Error` whose message names the plugin and the missing key

#### Scenario: Per-plugin dictionary isolation

- **GIVEN** plugin `trivia` has registered `{ en: { answered: "Answered" } }`
- **AND** plugin `weather` has registered `{ en: { answered: "Replied" } }` on its own SDK
- **WHEN** `trivia`'s `sdk.t("answered")` is called
- **THEN** it returns `"Answered"` regardless of what `weather` registered
- **AND** `weather`'s `sdk.t("answered")` returns `"Replied"`

#### Scenario: t() before registerDictionary

- **GIVEN** a plugin's SDK has NOT called `registerDictionary` yet
- **WHEN** the plugin calls `sdk.t("any-key")`
- **THEN** the call throws an `Error` whose message tells the plugin to call `registerDictionary` first

### Requirement: SDK engageThread Method

The plugin SDK (`ClackSdk`) SHALL expose an `engageThread(channel, threadTs, { attentionLevel, followUpContext })` method so plugin code that posts via the raw Slack client (e.g. `sdk.getSlackClient().chat.postMessage`) can make the thread it posted into engaged.

`engageThread` SHALL wrap the core engaged-thread-registration primitive: a non-`"off"` `attentionLevel` seeds a discoverable engaged session for `(channel, threadTs)` carrying the level and the optional `followUpContext`; `"off"` (or omitted) is a no-op. This is the ONLY engagement path available to plugins — plugins MUST NOT import core session modules directly (per the plugin hard rules).

#### Scenario: Plugin engages a thread it posted into

- **GIVEN** a plugin posted a message to `C1` whose timestamp is `1700000000.000400`
- **WHEN** the plugin calls `sdk.engageThread("C1", "1700000000.000400", { attentionLevel: "high", followUpContext: "…" })`
- **THEN** an engaged session is seeded for `(C1, "1700000000.000400")` with `attentionLevel: "high"` and the supplied follow-up context

#### Scenario: Off level is a no-op

- **WHEN** the plugin calls `sdk.engageThread("C1", "T", { attentionLevel: "off" })`
- **THEN** no session is seeded

#### Scenario: Plugins do not import core session modules

- **WHEN** the trivia or casual-talk plugin engages a thread
- **THEN** it does so only through `sdk.engageThread` (or a Claude-authored `deliver_to`/`post_to` field)
- **AND** it does not import `src/sessions.ts` or any core module outside the plugin folder

### Requirement: ClackSdk Exposes User Registry Accessor

The `ClackSdk` interface SHALL expose a `users` accessor giving plugins read access to centralized user identity and read/merge access to the plugin's own per-user namespace, without exposing population, persistence, or freshness concerns. The accessor SHALL provide exactly `get`, `list`, and `data(schema)`.

#### Scenario: get and list expose core identity

- **WHEN** a plugin calls `sdk.users.get(userId)` or `sdk.users.list()`
- **THEN** the SDK returns core identity (`{ userId, displayName }`) sourced from the central registry
- **AND** the plugin does not need to fetch or cache display names from Slack itself

#### Scenario: data(schema) is auto-scoped to the calling plugin

- **WHEN** a plugin calls `sdk.users.data(schema).get(userId)` or `.merge(userId, partial)`
- **THEN** the SDK resolves the namespace to `plugins.<callerPluginName>` on the user record (the same auto-scoping convention as `readFile`/`writeFile`)
- **AND** the plugin can neither read nor write another plugin's namespace

#### Scenario: Namespace data validated by the plugin's own schema

- **WHEN** a plugin reads or merges through `sdk.users.data(schema)`
- **THEN** the SDK round-trips the namespace value through the plugin-supplied zod schema
- **AND** returns the parsed value on success or `null` on absence/mismatch, never throwing on malformed stored data

