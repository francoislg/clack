## Why

Adding new tool modules to Clack currently requires wiring into multiple internal systems (tool server, cascading config resolver, permissions). This tight coupling makes extensions hard to develop, test, and maintain independently. The trivia game module already exists at `src/plugins/trivia/` and needs a formal integration path — and future modules will face the same problem.

## What Changes

- Introduce a `ClackPlugin` contract: a function that receives a `ClackSdk` and uses it to register instructions and tools
- Create `ClackSdk` interface providing scoped data access (`data/plugins/{name}/`), instruction registration (virtual files in the cascading resolver), and tool registration (with role gating)
- Add a built-in plugin registry (`src/plugins/registry.ts`) mapping plugin names to their entry functions
- Add `plugins: string[]` to `config.json` to declare which plugins are active
- Extend `resolveInstructions()` to accept virtual default files contributed by plugins
- **BREAKING**: Rename `data/plugins/` (SDK skill packs) to `data/skill-plugins/` to free the path for Clack plugin data. Requires a boot migration.
- Refactor the existing trivia module to use the new plugin contract

## Capabilities

### New Capabilities
- `clack-plugins`: The plugin system — SDK interface, registry, loading lifecycle, integration with tool server and cascading resolver

### Modified Capabilities
- `cascading-config-resolver`: Must accept virtual default files from plugins alongside disk-based defaults
- `clack-tools`: Tool server must integrate plugin-registered tools with role-based gating

## Impact

- **Config**: New `plugins` field in `config.json`
- **Data directory**: `data/plugins/` renamed to `data/skill-plugins/`; `data/plugins/` repurposed for plugin runtime data
- **Cascading resolver**: `resolveInstructions()` signature changes to accept virtual files
- **Tool server**: `buildQueryTools()` must iterate loaded plugins and include their tools
- **Existing SDK plugin references**: `src/plugins.ts`, `src/claude/index.ts`, `src/changes/execution.ts`, `src/slack/homeTab.ts` — all references to old `data/plugins/` path must update
- **Home Tab UI**: Existing "Plugins:" label renamed to "Skill Plugins:"; new "Plugins:" section added to display loaded Clack plugins
- **Migration**: New boot migration (013) to rename directory
