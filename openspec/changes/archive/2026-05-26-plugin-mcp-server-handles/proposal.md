## Why

Today a plugin that wants on-demand tools must coordinate three separate, string-keyed SDK calls — `registerIntegration("trivia:management", ...)`, `registerTool(..., { integration: "trivia:management" })`, and `addTopicInstruction("admin", "trivia:management", ...)`. The three concepts are conventionally coupled but structurally independent, which already produced one production bug: `attach_integration("trivia:management")` succeeded in bookkeeping (the integration was registered) but the gated plugin tools never became callable, because the plugin's MCP server is built once at session start with the integration filter applied, and `attach_integration` for instructions-only integrations skips the `setMcpServers` rebuild path. Claude attached the integration, then immediately failed every `mcp__trivia__upsert_season` call with `No such tool available`.

Beyond the bug, the three-call dance is hostile to plugin authors: typos in the integration string aren't caught at compile time, the relationship between tools and their integration isn't visible from the call sites, and `addTopicInstruction` requires re-stating the integration name every time. A first-class "MCP server handle" returned from `registerMcpServer` would collapse all three concerns into one object reference — fixing the bug structurally and making the right shape the easy shape.

## What Changes

- **BREAKING (plugin SDK):** Add `sdk.registerMcpServer(name, options) → RegisteredMcpServer` to the plugin SDK. The returned handle exposes `.registerTool(...)` and `.addTopicInstruction(...)` methods that bind the tool/instruction to that server.
- **BREAKING (plugin SDK):** Add an implicit always-on default server `sdk.mcpServer` per plugin. Tools registered via `sdk.registerTool(...)` (no handle) continue to land on this default server — back-compat for plugins with no on-demand surface (giphy, tenor-gif).
- **BREAKING (plugin SDK):** Remove `sdk.registerIntegration(name, options)`. Its role is absorbed by `sdk.registerMcpServer(name, { autoload: false, description })`.
- **BREAKING (plugin SDK):** Remove the `{ integration: string }` option on `sdk.registerTool(...)`. Tools bound to an on-demand server use `handle.registerTool(...)` instead.
- **BREAKING (plugin SDK):** `sdk.addTopicInstruction(role, topic, filename, content)` remains for baseline topics (e.g., trivia's `persona.md` pre-attached via `CronJobSpec.attachedTopics`). Handle-scoped `handle.addTopicInstruction(role, filename, content)` is the new way to ship instructions paired with an on-demand server — the topic name is implicit (the server's full name).
- Plugin names auto-prefix the registered server name: `sdk.registerMcpServer("management", ...)` on the trivia SDK exposes the server publicly as `trivia:management` (catalog entry) and `mcp__trivia_management__*` (MCP namespace). The `:` → `_` mapping for MCP names already matches today's `<plugin>:<key>` convention.
- `attach_integration(name)` resolves a name to an MCP server config via a single lookup — either `data/mcp.json` (external) or the plugin-registered server registry (internal). The current `serverConfig ?? manager.getIntegrationServer(name)` fallback in `attachIntegration.ts` collapses into one resolver.
- Internal: `getToolsGatedByIntegration(name)` is replaced by `getServerTools(name)` (rename + slight semantic shift — it returns the tools the named server owns, not "tools gated by integration X").
- Migration: trivia plugin updates its 7 management tool registrations and 1 topic instruction to use the new handle. Giphy/tenor-gif plugins are unaffected (no on-demand surface).
- CLAUDE.md "topics vs integrations" section rewritten as "topics vs MCP servers" with the new mental model.

## Capabilities

### New Capabilities

(none — this redesigns existing capabilities)

### Modified Capabilities

- `clack-plugins`: Replace `registerIntegration` and `{ integration }` SDK contract with `registerMcpServer → RegisteredMcpServer` handle, including `.registerTool` and `.addTopicInstruction` methods. Update integration-gating requirement to "MCP server membership" semantics. Default-server (`sdk.mcpServer`) requirement added.
- `lazy-mcp-loading`: `attach_integration(name)` resolution unified — single lookup against the effective MCP server set (external + plugin-registered). Remove the "instructions-only integration" path as a distinct case; plugin-registered on-demand servers become full MCP servers with tools, so attach always loads tools when there are any.

## Impact

- **Plugin SDK surface (`src/plugins/sdk.ts`)**: new `registerMcpServer`, removed `registerIntegration` + `integration` option on `registerTool`, new `RegisteredMcpServer` type with methods.
- **Plugin registry / state (`src/plugins/registry.ts`, `src/plugins/state.ts`)**: per-plugin server collection replaces flat per-tool integration field.
- **Tool server assembly (`src/tools/server.ts`)**: replaces the per-integration grouping currently in flight; one SDK server per registered handle, on-demand ones registered with the manager.
- **MCP server manager (`src/claude/mcpServerManager.ts`)**: keeps the `registerIntegrationServer`/`getIntegrationServer` methods added during the in-flight Option B implementation — they remain the right shape for the new design.
- **`attach_integration` tool (`src/tools/query/attachIntegration.ts`)**: simpler — one resolver, no instructions-only fork.
- **Trivia plugin (`src/plugins/trivia/index.ts`)**: 7 management tool registrations migrate to handle; 1 topic instruction migrates to handle. Other ~16 always-on tool registrations stay on `sdk.mcpServer` (or `sdk.registerTool` shorthand) unchanged.
- **Tests**: existing integration-gating tests (`src/plugins/trivia/integration.gating.test.ts`, `src/tools/server.test.ts`'s integration-gated plugin tools describe block, `src/tools/query/attachIntegration.test.ts`) rewritten against the new API.
- **Docs**: `CLAUDE.md` and `src/plugins/CLAUDE.md` "topics vs integrations" sections rewritten.
- **In-flight work**: the partial Option B implementation on disk (modifications to `src/tools/server.ts`, `src/claude/mcpServerManager.ts`, `src/tools/query/attachIntegration.ts`, `src/plugins/state.ts`, and the integration-gating test) is superseded by this redesign. Some pieces (the manager's `registerIntegrationServer`/`getIntegrationServer` methods) survive verbatim; the per-integration grouping in `server.ts` is replaced by handle-based assembly.
