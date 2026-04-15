## Why

Scheduled runs (and other trigger types) currently have no way to guarantee that Claude performs a specific side-effect before delivering a response. For example, a daily trivia cron job needs `submit_answers` to be called during the run — but today Claude can call `submit_response` without ever touching the required plugin tool, and the run completes successfully with no enforcement.

A second, related problem blocks the clean design of this enforcement: plugin tools currently share the `clack` MCP server namespace with core tools and with each other. Plugin-vs-plugin name collisions are silently possible, and tool-call history does not clearly attribute calls to their owning plugin. Any `requiredTools` config string would be ambiguous about what it refers to.

## What Changes

- **BREAKING**: Each loaded Clack plugin is exposed as its own MCP server (named after the plugin) instead of being merged into the `clack` server. Plugin tools appear to Claude as `mcp__<plugin>__<tool>` (e.g., `mcp__trivia__submit_answers`).
- `buildQueryTools()` returns multiple MCP servers (core `clack` plus one per loaded plugin); the tool-call recorder wraps plugin tool handlers transparently so every call is recorded regardless of whether the plugin opted in.
- The plugin-vs-core name-collision guard in `buildQueryTools()` is removed (no longer needed — different servers, no collision possible).
- Tool-mapping loader stops force-merging plugin mappings into the `clack` mapping; each plugin's mappings live under its own server-name key.
- `submit_response` gains a `requiredTools` gate: before delivering, it checks the tool-call recorder for each required tool name and refuses delivery (returning an actionable error to Claude) until all required tools have been called at least once during the run.
- `ProcessMessageParams` gains an optional `requiredTools?: string[]` field, threaded through `ProcessingContext` and `QueryToolContext` into `SubmitResponseDeps`.
- Cron job config (`CronJob`) gains an optional `requiredTools?: string[]` field (explicit per-job tool names) and an optional `plugin?: string` field (names a loaded plugin the job is associated with). Both are populated into `ProcessMessageParams` at trigger time. The scheduler unions the explicit `requiredTools` with the named plugin's declared scheduled-run defaults.
- Plugin SDK gains `sdk.requireToolsForScheduled(tools: string[])` — plugins declare the bare tool names that scheduled runs linked to the plugin must invoke. At trigger time, the names are prefixed to their full MCP form (`mcp__<plugin>__<tool>`) and merged into the effective `requiredTools` list.
- The `create_scheduled_message` and `update_scheduled_message` tools expose both `plugin` and `requiredTools` so Claude can set them on the user's behalf. `list_scheduled_messages` emits the fields so they're visible.

## Capabilities

### New Capabilities

_(none — this change modifies existing capabilities only)_

### Modified Capabilities

- `clack-plugins`: Each plugin now owns a dedicated MCP server namespace instead of sharing `clack`. Plugin load result exposes an MCP server per plugin. Tool-call recording for plugin tools is guaranteed by the SDK.
- `clack-tools`: Query tool assembly produces multiple MCP servers (one per plugin plus `clack`) instead of a single server; callers receive a record of MCP servers rather than one instance. Plugin-vs-core collision guard is removed.
- `clack-tool-response`: `submit_response` refuses delivery when any required tool from the session context has not been recorded during the run, returning an error that names the missing tool(s). Required-tools config is supplied per-session via the processing context.
- `cron-messages`: Cron job definitions may declare `requiredTools` — a list of fully-qualified tool names (e.g., `mcp__trivia__submit_answers`) that must be called during the run before `submit_response` will accept delivery.
- `tool-label-config`: Plugin tool mappings are keyed by plugin server name, not merged into `clack`. Existing `clack` mapping behavior is unchanged for core tools.

## Impact

- **Agent SDK integration** (`src/claude/index.ts`, `src/changes/execution.ts`): assembly of `mcpServers` record now spreads plugin servers alongside `clack`.
- **Tool server** (`src/tools/server.ts`): `buildQueryTools` returns `mcpServers: Record<string, McpServerConfig>` instead of a single `mcpServer`. Plugin integration loop creates per-plugin servers and wraps handlers with recorder.
- **Plugin SDK** (`src/plugins/sdk.ts`): `PluginLoadResult` grows an `mcpServer` field (or equivalent harvest output); registration-time wrapping ensures `recorder.record()` is called for every plugin tool invocation without the plugin author having to opt in.
- **Plugin state** (`src/plugins/state.ts`): loaded plugins carry their own MCP server instances.
- **Tool mapping** (`src/streaming/toolMappingLoader.ts`): remove the "merge plugin mappings into `clack`" loop; emit one mapping entry per plugin keyed by plugin name.
- **Tool labels** (`src/streaming/`): labels and tests that assume `mcp__clack__<plugin-tool>` format update to `mcp__<plugin>__<tool>`.
- **submit_response** (`src/tools/presentation/submitResponse.ts`): new pre-delivery validation against `requiredTools` using the existing `ToolCallRecorder`.
- **Core handler plumbing** (`src/slack/handlers/core.ts`): `ProcessMessageParams`, `ProcessingContext`, and `QueryToolContext` thread a new optional `requiredTools: string[]`.
- **Cron scheduler** (`src/cronScheduler.ts`, `src/cronJobs.ts`): `CronJob` type grows `requiredTools?: string[]`; `executeDynamicJob` passes it into `processMessage`.
- **Trivia plugin** (`src/plugins/trivia/*`): no code changes required — but the plugin's tool identities change externally (from `submit_answers` to `mcp__trivia__submit_answers`), which cascades to any instruction text or config that referred to raw tool names.
- **Tests**: `src/tools/server.test.ts`, `src/streaming/toolLabels.test.ts`, plugin SDK tests, and any fixture that asserts the `mcp__clack__<plugin-tool>` form all need updates.
- **Migration**: no data migration required. Config changes (`requiredTools`, `plugin` on cron jobs) are purely additive and default to absent. Plugin-declared defaults are loaded in memory at plugin-load time; no persisted state changes.
