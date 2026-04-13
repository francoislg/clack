## 1. Directory Rename Migration

- [x] 1.1 Create boot migration 013 to rename `data/plugins/` to `data/skill-plugins/` (skip if target exists)
- [x] 1.2 Update `src/plugins.ts` to scan `data/skill-plugins/` instead of `data/plugins/`
- [x] 1.3 Update `src/plugins.test.ts` for the new path
- [x] 1.4 Register migration in `src/migrations/index.ts`

## 2. ClackSdk and Plugin Types

- [x] 2.1 Create `src/plugins/sdk.ts` with `ClackSdk` interface and `ClackPlugin` type
- [x] 2.2 Implement `createClackSdk(pluginName)` factory that returns a scoped SDK builder (accumulates instructions/tools, scopes file I/O to `data/plugins/{name}/`)
- [x] 2.3 Add path traversal validation to `readFile`/`writeFile` (reject `../` and absolute paths)
- [x] 2.5 Add tests for SDK path traversal rejection
- [x] 2.4 Add `meetsMinimumRole(userRole, minRole)` helper to `src/permissions.ts`

## 3. Plugin Registry and Loading

- [x] 3.1 Create `src/plugins/registry.ts` with `BUILTIN_PLUGINS` map and `loadPlugins(pluginNames)` function
- [x] 3.2 Add `plugins?: string[]` field to the `Config` type in `src/config.ts`
- [x] 3.3 Wire plugin loading into startup in `src/index.ts` — call `loadPlugins()` after config is loaded, wrap each plugin in try/catch (log error with plugin name, skip, continue), store result
- [x] 3.4 Export loaded plugin state (virtual instructions, registered tools with minRole, and persisted SDK instances for tool closure data access) for consumption by resolver and tool server

## 4. Cascading Resolver Integration

- [x] 4.1 Add optional `virtualDefaults` parameter to `resolveInstructions()` — `Map<string, Map<string, string>>` (role → filename → content)
- [x] 4.2 Update inner resolution loop: check virtual defaults between disk default and disk custom for each role tier
- [x] 4.3 Include virtual filenames in the file discovery set
- [x] 4.4 Update `listRoleDirFiles()` to include virtual files with `source: "plugin"` indicator
- [x] 4.5 Update `loadInstructions()` in `src/instructions.ts` to pass plugin virtual defaults to the resolver
- [x] 4.6 Add tests for virtual default resolution: (1) virtual default included when no disk files exist, (2) disk custom override wins over virtual default, (3) virtual filenames appear in file discovery with `source: "plugin"`, (4) resolution order matches spec (disk default → virtual → disk custom per role tier)

## 5. Tool Server Integration

- [x] 5.1 Update `buildQueryTools()` in `src/tools/server.ts` to accept loaded plugin tools
- [x] 5.2 Filter plugin tools by user role using `meetsMinimumRole()` and push matching tools to the array
- [x] 5.3 Add duplicate tool name detection — core tools take precedence over plugin tools, log warning and drop the plugin tool
- [x] 5.4 Wrap plugin tool handlers with try/catch — a failing plugin tool returns `errorResult` rather than crashing the query
- [x] 5.5 Update `buildClackTools()` call sites (`src/claude/index.ts`, `src/changes/execution.ts`) to pass plugin tools
- [x] 5.6 Add tests for plugin tool gating by role

## 6. Trivia Plugin Refactor

- [x] 6.1 Rewrite trivia data layer to use `ClackSdk.readFile`/`writeFile` instead of direct `fs` calls
- [x] 6.2 Convert `src/plugins/trivia/index.ts` to export a `ClackPlugin` function that uses `sdk.addInstruction()` and `sdk.registerTool()`
- [x] 6.3 Move instruction content from `trivia.md` into the plugin function (read at module load via readFileSync)
- [x] 6.4 Delete `trivia.md` file — kept as a separate file read at module load time for maintainability
- [x] 6.5 Register trivia in `BUILTIN_PLUGINS` registry
- [x] 6.6 Update trivia tests for the new data layer

## 7. Home Tab Updates

- [x] 7.1 Rename existing "Plugins:" label to "Skill Plugins:" in `src/slack/homeTab.ts` (reflects the `data/skill-plugins/` rename)
- [x] 7.2 Add a new "Plugins:" section that displays loaded Clack plugins (name, tool count) when `plugins` config is non-empty
- [x] 7.3 Update Home Tab deps interface to accept loaded plugin info
- [x] 7.4 Update Home Tab tests for both renamed skill plugins section and new Clack plugins section

## 8. Verification

- [x] 8.1 Type-check passes (`npx tsc --noEmit`)
- [x] 8.2 All tests pass (`npm test`) — 2161 tests, 0 failures
- [ ] 8.3 Manual test: add `"plugins": ["trivia"]` to config.json, verify trivia tools appear and are gated by role, verify trivia instructions are in the prompt, verify Home Tab shows both "Skill Plugins:" and "Plugins:" sections, verify admin can override `trivia__instructions.md` in `configuration/`
