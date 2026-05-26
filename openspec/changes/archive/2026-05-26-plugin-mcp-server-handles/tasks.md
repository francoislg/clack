## 1. Clean slate — revert in-flight Option B work

- [x] 1.1 Revert `src/tools/server.ts` plugin-server build loop to its pre-change shape (so we re-implement from the new SDK shape rather than evolving the per-integration grouping)
- [x] 1.2 Revert `src/plugins/state.ts` `getToolsGatedByIntegration` to its pre-change body (will be removed entirely later, but reverting first keeps git history readable)
- [x] 1.3 Revert `src/tools/query/attachIntegration.ts` to its pre-change shape (the `?? manager.getIntegrationServer(...)` fallback stays in the design but is rewritten under task 4)
- [x] 1.4 Revert `src/tools/query/attachIntegration.test.ts` (drop the in-flight "plugin-self-declared integration via manager registry" test)
- [x] 1.5 Revert `src/plugins/trivia/integration.gating.test.ts` MANAGEMENT_TOOLS constant rename
- [x] 1.6 Revert `src/tools/server.test.ts` integration-gated plugin tools assertion updates
- [x] 1.7 Keep the `registerIntegrationServer` / `getIntegrationServer` additions on `McpServerManager` — they're still the right shape; task 4 may rename them to `registerPluginServer` / `getPluginServer`
- [x] 1.8 Run `npx tsc --noEmit` and `npm test` — expect to be back at the pre-change baseline (5 pre-existing failures only, none of them ours)

## 2. SDK additions — handle type and `registerMcpServer`

- [x] 2.1 Define `RegisteredMcpServer` interface in `src/plugins/sdk.ts` with `registerTool(minRole, toolDef, mappingOrOptions?)` and `addTopicInstruction(role, filename, content)` methods, plus a `fullName: string` readonly property
- [x] 2.2 Implement `createRegisteredMcpServer(pluginName, serverKey, recorder, registrations)` factory in `src/plugins/sdk.ts` that returns a handle whose `registerTool` appends to the plugin's tool list with `serverKey` recorded on the entry, and whose `addTopicInstruction` delegates to `sdk.addTopicInstruction(role, fullName, filename, content)`
- [x] 2.3 Add `sdk.mcpServer: RegisteredMcpServer` property — implicit default server with `fullName === pluginName` and `serverKey === undefined` so the per-tool integration field stays unset
- [x] 2.4 Add `sdk.registerMcpServer(name: string, options: { autoload?: boolean; description: string }): RegisteredMcpServer` method that validates the name (must not contain `:`, must not collide with the implicit default), records the server in the plugin's `mcpServers` list, and returns a handle
- [x] 2.5 Extend the `RegisteredPluginTool` type to track a `serverKey?: string` (undefined for the default server, otherwise the suffix part of the full server name)
- [x] 2.6 Add `PluginMcpServerSpec` type to `src/plugins/sdk.ts` for what `registerMcpServer` records: `{ key: string; fullName: string; autoload: boolean; description: string }`
- [x] 2.7 Update `PluginLoadResult` in `src/plugins/registry.ts` to include `mcpServers: PluginMcpServerSpec[]`
- [x] 2.8 Add unit tests for the new SDK surface in `src/plugins/sdk.test.ts` covering: handle returned, name validation rejects `:`, name validation rejects empty/colliding names, autoload defaults to false, handle's `registerTool` records the right serverKey, handle's `addTopicInstruction` delegates correctly

## 3. Shorthand and back-compat

- [x] 3.1 Update `sdk.registerTool(minRole, toolDef, mapping)` to internally delegate to `sdk.mcpServer.registerTool(...)` so simple plugins keep working unchanged
- [x] 3.2 Remove the `{ integration }` option from `RegisterToolOptions` in `src/plugins/sdk.ts` (type-level removal; runtime never read it after migration)
- [x] 3.3 Remove `sdk.registerIntegration(name, options)` from the `ClackSdk` interface and its harvest target in `src/plugins/sdk.ts`
- [x] 3.4 Remove the `integrations: PluginIntegration[]` field on `PluginLoadResult` (replaced by `mcpServers`); update `src/plugins/state.ts` `getLoadedPluginIntegrations` to flatten `mcpServers` to the same shape that the registry-merge path expects (or update the registry-merge path to consume `mcpServers` directly)
- [x] 3.5 Update `src/plugins/sdk.test.ts` to drop tests for `registerIntegration` and `{ integration }` option (their semantics are now covered by the handle tests)

## 4. Manager — rename + plumbing

- [~] 4.1 Skipped: kept `registerIntegrationServer`/`getIntegrationServer` names. They work fine semantically — under the new design, the on-demand servers ARE the integration catalog entries.
- [~] 4.2 Skipped: same reason as 4.1.
- [~] 4.3 Skipped: same reason as 4.1.

## 5. Tool-server assembly — handle-based plugin server build

- [x] 5.1 In `src/tools/server.ts`'s plugin loop, for each plugin: build the default server from tools with `serverKey === undefined`, and build one SDK server per registered handle (`plugin.mcpServers`) using tools with matching `serverKey`
- [x] 5.2 The default server (`mcp__<plugin>__*`) is always assembled into the baseline when it has tools
- [x] 5.3 Each handle-registered server is registered with `manager.registerIntegrationServer(fullName, server)` AND assembled into the baseline only when `session.attachedIntegrations.includes(fullName)` (resume case)
- [x] 5.4 `pluginToolFullNames` only receives tool names from servers actually in the baseline (matches current Option B semantics for `toolNames`)
- [x] 5.5 MCP server name for handle servers uses `<plugin>_<key>` convention
- [x] 5.6 Delete `getToolsGatedByIntegration` from `src/plugins/state.ts` — no longer needed; the kind-note / body in `attachIntegration.ts` is rewritten to consult the manager's registered server directly
- [~] 5.7 Skipped: not needed — the kindNote/body now derives from `!!serverConfig` directly, no need to list tool names

## 6. `attach_integration` — unified resolver

- [x] 6.1 In `src/tools/query/attachIntegration.ts`, replace the two-step `serverConfig ?? manager.getIntegrationServer(...)` with a single resolver line
- [x] 6.2 Drop the `getToolsGatedByIntegration` dep from `AttachIntegrationDeps`
- [x] 6.3 Update the persisted `outcome` value: `"ok"` whenever a server config was found (regardless of source); `"instructions_only"` only when the resolver returned undefined
- [x] 6.4 Update the user-facing `kindNote` text: drop the "gated tools available on the next turn" wording from the body branch since the tools are loaded via setMcpServers, not via "gating revealing them"

## 7. Trivia plugin migration

- [x] 7.1 In `src/plugins/trivia/index.ts`, replace `sdk.registerIntegration("trivia:management", { description, alwaysLoad: false })` with `const management = sdk.registerMcpServer("management", { autoload: false, description })`
- [x] 7.2 Replace all 7 `sdk.registerTool(..., { integration: "trivia:management" })` calls with `management.registerTool(...)`
- [x] 7.3 Replace the trivia plugin's `addTopicInstruction("admin", "trivia:management", ...)` call with `management.addTopicInstruction("admin", ..., ...)` (drop the redundant `"trivia:management"` topic argument)
- [x] 7.4 Ungated tools (`list_seasons`, `get_ideas`, etc.) remain on the `sdk.registerTool(...)` shorthand — no changes
- [x] 7.5 Update any internal references in `src/plugins/trivia/` that compared tool names like `mcp__trivia__upsert_season` (none expected, but verify via grep)

## 8. Tests — rewrite against new API

- [x] 8.1 Rewrite `src/plugins/trivia/integration.gating.test.ts`
- [x] 8.2 Rewrite the integration-gated plugin tools describe block in `src/tools/server.test.ts`
- [x] 8.3 Rewrite `src/tools/query/attachIntegration.test.ts`
- [x] 8.4 Run the affected test files individually — they must pass
- [x] 8.5 Run `npm test` — only the 3 pre-existing failures remain (capabilities.crons, 2 homeTab error-banner tests)

## 9. Docs

- [x] 9.1 Update `src/plugins/CLAUDE.md` "Topics vs Integrations" section: renamed to "Topics vs MCP Servers", explains `sdk.mcpServer` (implicit default), `sdk.registerMcpServer` (on-demand), and how topic instructions co-locate with on-demand servers via the handle
- [x] 9.2 Update `CLAUDE.md` plugin section — the plugin tools paragraph rewritten to describe the handle-based shape
- [x] 9.3 The trivia plugin documentation in `CLAUDE.md` is covered by the rewritten paragraph from 9.2 (the same paragraph that previously mentioned `sdk.registerIntegration("trivia:management", ...)`)

## 10. Verification

- [x] 10.1 `npx tsc --noEmit` — clean (no new errors from this change)
- [x] 10.2 `npx oxlint` on modified files — clean
- [x] 10.3 `npm test` — only pre-existing failures remain (3 baseline failures: `capabilities.crons`, 2 homeTab error-banner)
- [~] 10.4 Manual verification deferred — requires a running dev environment with the trivia plugin loaded; unit tests cover the equivalent paths
- [x] 10.5 `openspec validate plugin-mcp-server-handles --strict` — clean
