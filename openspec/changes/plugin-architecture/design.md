## Context

Clack's tool server (`src/tools/server.ts`) and instruction system (`src/cascadingConfigResolver.ts`) are tightly coupled to the core codebase. Adding a new tool module today means editing `server.ts` imports, adding conditional registration logic, and placing instruction files in the shared `data/default_configuration/` tree. The trivia game module at `src/plugins/trivia/` demonstrates the need — it has tools and instructions but no formal way to integrate without modifying core.

The existing `data/plugins/` directory is used for Claude Code SDK skill packs (`.claude-plugin/` manifests), which is a completely separate concept. This creates a naming conflict that must be resolved.

## Goals / Non-Goals

**Goals:**
- A plugin is a single function: `(sdk: ClackSdk) => Promise<void>`
- Plugins register instructions and tools imperatively through the SDK
- Plugin data is scoped to `data/plugins/{name}/` via SDK file I/O
- Plugin instructions participate in the cascading resolver as virtual defaults, overridable by admins
- Plugin tools are gated by a declared minimum role
- Built-in plugin registry with config-driven activation (`plugins: ["trivia"]`)
- Refactor the trivia module as the first plugin

**Non-Goals:**
- External/dynamic plugin loading (future — requires dynamic `import()`, hot reload, error isolation)
- Plugin-to-plugin communication
- Plugin lifecycle hooks (onEnable, onDisable, etc.)
- Plugin-specific config in `config.json` beyond the name list

## Decisions

### 1. Plugin contract is a function, not a class or interface

```typescript
type ClackPlugin = (sdk: ClackSdk) => Promise<void>;
```

**Why:** A function is the simplest possible contract. The plugin calls SDK methods to register what it needs — no schema to version, no interface to implement. The SDK is additive: new capabilities = new methods. A class would add ceremony without value since there's no lifecycle to manage (non-goal).

**Alternative considered:** Declarative interface (`{ name, instructions, tools }`). Rejected because it can't express conditional registration (e.g., "only register this tool if my config file exists").

### 2. ClackSdk is a builder that accumulates registrations

```typescript
interface ClackSdk {
  addInstruction(role: RoleDir, filename: string, content: string): void;
  registerTool(minRole: UserRole, tool: SdkMcpToolDefinition): void;
  readFile(path: string): Promise<string | null>;
  writeFile(path: string, content: string): Promise<void>;
}
```

Clack creates a scoped SDK instance per plugin, calls the plugin function, then harvests the accumulated instructions and tools. The SDK instance stays alive — tool handler closures reference `readFile`/`writeFile` for ongoing data access.

**Why scoped file I/O:** Plugins should not access each other's data or core data directories. The SDK resolves `readFile("scores.json")` to `data/plugins/trivia/scores.json` internally. Path traversal (`../`) is rejected.

### 3. Instruction filenames are auto-prefixed

When a plugin calls `sdk.addInstruction("user", "instructions", content)`, the SDK stores it as `trivia__instructions.md`. The plugin doesn't know about the prefix convention.

**Why:** Prevents collisions between plugins and between plugins and core files. Double underscore (`__`) is visually distinct and unlikely in organic filenames.

### 4. Virtual files inject into the cascading resolver between defaults and overrides

Resolution order per filename:
1. Core disk default (`data/default_configuration/{role}/{file}`)
2. Plugin virtual default (in-memory, from `addInstruction`)
3. Admin disk override (`data/configuration/{role}/{file}`)

Step 3 wins if present, allowing admins to override plugin instructions through the normal Home Tab mechanism.

**Implementation:** `resolveInstructions()` gains an optional parameter:
```typescript
type VirtualDefaults = Map<string, Map<string, string>>; // role → filename → content
resolveInstructions(roleChain: RoleDir[], virtualDefaults?: VirtualDefaults): string
```

The inner loop changes from 2 steps (default disk, custom disk) to 3 steps (default disk, virtual default, custom disk).

### 5. Tool registration uses minimum role string

```typescript
sdk.registerTool("member", createGetPastTopicsTool(data));
sdk.registerTool("dev", createGenerateQuestionTool(data));
```

At query time, Clack filters registered tools: only include tools where the user's role meets the declared minimum. Uses the existing role hierarchy (`member < dev < admin < owner`) and `meetsMinimumRole()`.

**Why not reuse `canRequestChanges`/`canEditConfig`:** Those are semantic permission checks tied to specific core features. Plugins need a generic role threshold.

### 6. Built-in registry with config activation

```typescript
// src/plugins/registry.ts
const BUILTIN_PLUGINS: Record<string, ClackPlugin> = {
  trivia: triviaPlugin,
};
```

`config.json` declares `plugins: ["trivia"]`. At startup, each name is looked up in the registry, an SDK is created, and the plugin function is called. Unknown names log a warning and are skipped.

**Why not auto-discover:** Explicit activation avoids surprises. A plugin existing in code doesn't mean it should be active.

### 7. Rename `data/plugins/` to `data/skill-plugins/`

The current `data/plugins/` holds Claude Code SDK skill packs. Rename to `data/skill-plugins/` via a boot migration (013), then repurpose `data/plugins/` for Clack plugin runtime data.

All references in `src/plugins.ts`, `src/claude/index.ts`, `src/changes/execution.ts`, `src/slack/homeTab.ts` update to the new path.

## Risks / Trade-offs

**[Plugin errors crash Clack]** → Wrap `pluginFn(sdk)` in try/catch. Log the error, skip the plugin, continue startup. Plugin tool handlers should also be wrapped — a failing tool returns `errorResult` rather than crashing the query.

**[Data directory conflicts during rename migration]** → Migration checks if `data/skill-plugins/` already exists before renaming. If both exist (manual intervention), log a warning and skip.

**[Virtual file override discoverability]** → Admins might not know they can override `trivia__instructions.md`. The Home Tab's instruction file listing (`listRoleDirFiles`) should include virtual files with a `source: "plugin"` indicator. This requires extending `InstructionFileEntry`.

**[Plugin load order matters]** → If two plugins register the same instruction filename (after prefix, this shouldn't happen) or tool name, last-registered wins. Validate for duplicates during loading and warn.
