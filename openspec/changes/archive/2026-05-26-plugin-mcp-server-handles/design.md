## Context

The bot exposes plugin functionality to Claude through a layered system: each plugin registers tools into a per-plugin SDK MCP server (`mcp__trivia__*`), and an optional `integration` field on each tool gates whether the tool is visible at session start. Topic instructions are loaded into the system prompt via a parallel cascading-resolver path keyed on a topic name that, by convention, equals the integration name. Three separate SDK calls (`registerTool({ integration })`, `registerIntegration`, `addTopicInstruction`) cooperate via shared strings to model "plugin ships a tool group plus instructions; Claude opts in via `attach_integration`."

This loose coupling produced a bug (documented in [proposal.md](proposal.md)): `attach_integration` for plugin-self-declared integrations updated bookkeeping but didn't rebuild the plugin's MCP server, leaving the gated tools invisible to the SDK. A partial Option B implementation is currently on disk that splits plugin tools into per-integration SDK servers (`mcp__trivia_management__*`), with a per-session registry on `McpServerManager` (`registerIntegrationServer`/`getIntegrationServer`) and a unified attach path. That implementation fixes the bug but preserves the three-call SDK shape and the string-coupling problem.

This redesign keeps the per-integration-server runtime mechanic (already correct) and replaces the SDK surface that produces it with a single primitive returning a typed handle.

## Goals / Non-Goals

**Goals:**

- Make the relationship between a plugin's on-demand tools, their MCP server, their catalog entry, and their topic instructions a single object reference instead of three coordinated strings.
- Fix the bug where mid-session `attach_integration` calls for plugin-self-declared integrations don't reveal their tools.
- Make the wrong shape harder to write: a typo binding a tool to a non-existent server should fail at compile time, not silently disable the tool.
- Preserve every observable property of the existing system: tool names, instruction text, attach semantics, resume behavior, persistence.

**Non-Goals:**

- Changing the runtime attach mechanic. The per-integration SDK server already in flight is correct; we're replacing the SDK-author API, not the manager mechanics.
- Unifying plugin-registered servers with external MCP servers at the *declaration* layer. They remain declared differently (`registerMcpServer` vs `data/mcp.json`); only the attach-time resolution is unified.
- Eliminating string-keyed topic instructions entirely. `sdk.addTopicInstruction(role, topic, filename, content)` survives for baseline topics that aren't tied to an on-demand server (trivia's `persona.md`, `reveal-tone.md`, `finale-tone.md` pre-attached via `CronJobSpec.attachedTopics`).
- Removing `data/mcp.json` or changing how external MCP servers are configured.

## Decisions

### Decision 1: SDK shape — `registerMcpServer` returns a typed handle

The plugin SDK gains:

```ts
interface RegisteredMcpServer {
  /** Bind a tool to this server. Same signature as sdk.registerTool minus the integration option. */
  registerTool(
    minRole: MinRole,
    tool: SdkMcpToolDefinition,
    mappingOrOptions?: string | { label?: string; hidden?: boolean }
  ): void;
  /** Add a topic instruction keyed to this server's full name. */
  addTopicInstruction(role: PluginRole, filename: string, content: string): void;
}

interface ClackSdk {
  /** Always-on default server for this plugin (`mcp__<pluginName>__*`). Implicit. */
  readonly mcpServer: RegisteredMcpServer;

  /** Declare an on-demand named server. The full public name is `<pluginName>:<name>`. */
  registerMcpServer(
    name: string,
    options: { autoload?: boolean; description: string }
  ): RegisteredMcpServer;

  // ... existing methods ...
  /** Baseline topic instructions (not tied to any on-demand server). */
  addTopicInstruction(role: PluginRole, topic: string, filename: string, content: string): void;
}
```

The `sdk.registerTool(minRole, tool, mapping)` shorthand at the top level continues to work and is equivalent to `sdk.mcpServer.registerTool(...)`. This keeps simple plugins (giphy, tenor-gif) unaffected.

**Alternatives considered:**
- `sdk.registerTool(..., { server: handle })` — passes the handle as an option. Worse: still string-shaped at the call site for the common case, and the handle is just a setter argument rather than the binding target. Rejected.
- Drop the `sdk.mcpServer` implicit default; require every plugin to declare its main server. Cleaner conceptually, but verbose for plugins with no on-demand surface. Rejected on ergonomics.
- Make `registerMcpServer` return a curried `registerTool` only. Loses the `addTopicInstruction` co-location, which is half the win. Rejected.

### Decision 2: Server name resolution — auto-prefix with plugin name

`sdk.registerMcpServer("management", ...)` on the trivia SDK exposes the server as `trivia:management` in the catalog and `trivia_management` in the MCP namespace. The SDK enforces the prefix; plugins cannot register servers under arbitrary names that might collide with other plugins.

Rationale: today's convention (`<pluginName>:<key>` integration names) becomes structural. The SDK constructor knows the plugin name; injecting it removes cross-plugin collision risk and matches what plugin authors already write by hand.

**Alternatives considered:**
- Allow arbitrary names, validate uniqueness at registration time. Lets plugins choose ugly names; requires runtime validation. Rejected — automatic prefix is cleaner.
- Use `<plugin>_<key>` (underscore) in the catalog name too. Today's catalog uses `:` (per existing trivia entry); changing it would churn instruction files and prompt text. Rejected for parity.

### Decision 3: MCP server resolution — single resolver, two sources

`attach_integration(name)` resolves names via one function:

```ts
async function resolveAttachableServer(name: string): Promise<McpServerConfig | undefined> {
  return (await loadMcpServer(name))  // data/mcp.json
      ?? mcpManager.getRegisteredServer(name);  // plugin-registered
}
```

`loadMcpServer` is unchanged. The plugin-registered side uses the existing `registerIntegrationServer`/`getIntegrationServer` methods on `McpServerManager` (added during the in-flight Option B work — they remain correct under the new design, possibly renamed to `registerPluginServer`/`getPluginServer` for clarity).

This collapses the existing `if (serverConfig) { ... } else { instructions-only }` fork in `attachIntegration.ts`. The "instructions-only integration" path remains valid for genuinely instructions-only entries (e.g., `scheduling` declared in `data/config.json` with no `mcp.json` server and no plugin server), but its detection becomes simply "the resolver returned nothing".

### Decision 4: Topic instructions — handle-scoped is sugar over the existing API

`handle.addTopicInstruction(role, filename, content)` is implemented as:

```ts
// inside RegisteredMcpServer
addTopicInstruction(role, filename, content) {
  sdk.addTopicInstruction(role, this.fullName, filename, content);
}
```

The cascading resolver, virtual-defaults map, and on-disk override path (`data/configuration/<role>/topics/<name>/`) all stay identical. Only the call site changes. This isolates the redesign to the SDK author surface and avoids touching the well-tested cascade plumbing.

### Decision 5: Migration — single-shot, no back-compat shim

The current trivia plugin is the only plugin using `registerIntegration` / `{ integration }` / matching `addTopicInstruction`. Migrating it in the same change keeps the codebase clean. We delete the old SDK methods rather than ship them as deprecation stubs; the change is internal and the cost of clean deletion is one trivia file rewrite.

The on-disk session data shape is unchanged: `session.attachedIntegrations: string[]` continues to hold `"trivia:management"` etc., and the resume path still reads them and calls `attach_integration` with the same names. No migration script needed.

### Decision 6: In-flight Option B work — keep manager additions, replace server.ts grouping

The partial implementation on disk includes:
- ✓ Keep: `McpServerManager.registerIntegrationServer` / `getIntegrationServer` (probably rename) and `integrationServers` private field. The runtime mechanic is what we want.
- ✓ Keep: `attachIntegration.ts` unified `serverConfig ?? manager.getIntegrationServer(...)` resolver line.
- ✗ Replace: per-integration grouping loop in `buildQueryTools` (`server.ts`). The new design assembles servers from explicit handles registered by plugins, not by inferring them from a per-tool `integration` field.
- ✗ Replace: `getToolsGatedByIntegration` in `state.ts`. Becomes `getPluginServerTools` or similar — pulls from the explicit server collection.
- ✗ Revert: integration-gating test renames and the in-flight server.test.ts assertion updates. These need to be rewritten against the new API.

## Risks / Trade-offs

- **[Risk]** Plugin authors must learn a new pattern when adding on-demand surfaces. → **Mitigation**: `CLAUDE.md` and `src/plugins/CLAUDE.md` are updated alongside the code change; the giphy/tenor-gif/skill-pack examples in the repo demonstrate the simple shorthand path, the trivia migration demonstrates the handle path.
- **[Risk]** Implicit `sdk.mcpServer` means a plugin can register two "main" servers if it also calls `registerMcpServer("main", { autoload: true })`. → **Mitigation**: `registerMcpServer` validates that the requested name doesn't collide with the implicit default; throw at registration time.
- **[Risk]** Plugin-registered server name collisions across plugins (e.g., two plugins both registering `"shared"`). → **Mitigation**: auto-prefix with plugin name makes this structurally impossible; the full server names (`pluginA:shared` and `pluginB:shared`) cannot collide.
- **[Risk]** Tests covering the integration-gating semantics (now ~25 spread across `server.test.ts`, `integration.gating.test.ts`, `attachIntegration.test.ts`) all need rewriting. → **Mitigation**: the test count is bounded and the new shape is more testable (handle objects are easier to assert on than string-keyed maps).
- **[Trade-off]** The `sdk.addTopicInstruction(role, topic, filename, content)` signature with an explicit `topic` argument continues to exist for baseline topics, so the SDK now has two ways to add topic instructions. → Accepted: the baseline-topic case is genuinely different (no server, attached via `CronJobSpec.attachedTopics`), and forcing all topic instructions through a server handle would be the wrong shape.
- **[Trade-off]** Removing `registerIntegration` is a breaking change to the plugin SDK contract. Since trivia is the only in-tree caller, the cost is local. → Accepted.

## Migration Plan

1. Land the SDK additions (`registerMcpServer`, handle interface) alongside the implicit `sdk.mcpServer` default. Keep `registerIntegration` and `{ integration }` working in parallel for one commit so tests can be migrated incrementally.
2. Rewrite trivia to use the handle-based API; delete its `registerIntegration` call and `{ integration }` options.
3. Remove `registerIntegration` and the `{ integration }` option from the SDK.
4. Rewrite the three affected test files against the new API.
5. Update `CLAUDE.md` and `src/plugins/CLAUDE.md`.

No rollback strategy needed — the change is internal, no production data shape changes, the bot can be redeployed cleanly without migration.

## Open Questions

- Naming: `registerIntegrationServer` / `getIntegrationServer` on the manager were named under Option B's "integration" framing. Under this design, "plugin server" might fit better (`registerPluginServer` / `getPluginServer`). Decide during implementation; doesn't affect external behavior.
- Should `handle.addTopicInstruction(role, filename, content)` allow an optional override filename, or always derive it? Today's `sdk.addTopicInstruction(role, topic, filename, content)` lets the plugin choose the filename. We preserve that — `filename` is required on the handle method too. Topic name is implicit (the server's full name).
