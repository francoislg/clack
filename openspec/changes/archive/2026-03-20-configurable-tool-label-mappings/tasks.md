## 1. Types & Minimal Stubs

- [x] 1.1 Create `src/streaming/toolMappingLoader.ts` with types (`ToolMappingConfig`, `ResolvedToolMapping`) and stub exports: `interpolateLabel()`, `sanitizeArgValue()`, `loadToolMappings()`, `resetToolMappingCache()`

## 2. Tests — Template Engine (Layer 1)

- [x] 2.1 Test `interpolateLabel()`: simple arg substitution, multi-segment fallback chains, all-missing args with literal fallback, empty string args skipped
- [x] 2.2 Test `sanitizeArgValue()`: strips `<>@!\n`, truncates at 40 chars, shortens paths with `/`
- [x] 2.3 Test label truncation: labels under 80 chars pass through, over 80 chars get truncated with ellipsis
- [x] 2.4 Test edge cases: template with no placeholders (static string), adjacent placeholders, empty template

## 3. Implement Template Engine

- [x] 3.1 Implement `interpolateLabel(template, args)` — parse `{arg|arg|literal}` chains, arg lookup, literal fallback, final truncation to 80 chars
- [x] 3.2 Implement `sanitizeArgValue(value)` — strip `<>@!\n`, shorten paths, truncate to 40 chars

## 4. Shipped Default Configs

- [x] 4.1 Create `data/default_configuration/tool_mapping/_builtins.json` — Read, Glob, Grep, Edit, Write, Bash, Skill (with groups and itemDetail)
- [x] 4.2 Create `data/default_configuration/tool_mapping/clack.json` — all `mcp__clack__*` tools (with hidden for submit_response, report_status)
- [x] 4.3 Create `data/default_configuration/tool_mapping/github.json` — all `mcp__github__*` tools (with file-level group)
- [x] 4.4 Create `data/default_configuration/tool_mapping/sentry.json` — all `mcp__sentry__*` tools (with default fallback)
- [x] 4.5 Create `data/default_configuration/tool_mapping/statsig.json` — all `mcp__statsig__*` tools (with dynamic ID templates, default fallback)

## 5. Tests — Default Config Validation (Layer 2)

- [x] 5.1 Test: every JSON file in `data/default_configuration/tool_mapping/` parses as valid JSON and matches the `ToolMappingConfig` schema
- [x] 5.2 Test: every tool entry interpolates to a non-empty string with empty args (fallback paths work)
- [x] 5.3 Test: every tool entry interpolates to a non-empty string with a generic args blob (`{ file_path: "/a/b/c.ts", pattern: "foo", description: "test", id: "test-id", name: "test-name" }`)
- [x] 5.4 Test: every tool with a `group` reference has a matching entry in `groups` or file-level `group`

## 6. Implement Config Loader

- [x] 6.1 Implement `loadToolMappings()` — scan both `tool_mapping/` dirs, parse JSON, resolve overrides (user file fully replaces default)
- [x] 6.2 Implement `resolveConfig(config, filename)` — parse a `ToolMappingConfig` into `ResolvedToolMapping` (labels map, groups map, group titles, hidden set, default)
- [x] 6.3 Add caching: store result in module-level variable, return cached on subsequent calls
- [x] 6.4 Export `resetToolMappingCache()` for cache invalidation
- [x] 6.5 Add error handling: log warning and skip files with invalid JSON or unexpected schema

## 7. Rewrite toolLabels.ts

- [x] 7.1 Replace `getToolLabel()` — parse tool name into server+tool, look up in loaded mappings, interpolate template, apply fallbacks
- [x] 7.2 Replace `getToolGroup()` — resolve group from per-tool or file-level config, build `ToolGroupInfo` with interpolated itemDetail
- [x] 7.3 Keep `getToolDetails()` unchanged (stays in code, Slack mrkdwn)
- [x] 7.4 Remove all hardcoded maps: `TOOL_LABELS`, `GITHUB_TOOL_LABELS`, `SENTRY_TOOL_LABELS`, `STATSIG_TOOL_LABELS`, `PREFIX_LABELS`
- [x] 7.5 Keep helper functions that are still needed: `shortenPath()`, `truncate()` (may be shared with new module or moved)

## 8. Tests — Regression

- [x] 8.1 Update existing `toolLabels.test.ts` to work with config-driven lookups (set data dir to point at real default configs)
- [x] 8.2 Verify all existing test assertions still pass — same inputs produce same outputs for every previously-hardcoded tool

## 9. Cache Invalidation Integration

- [x] 9.1 Import and call `resetToolMappingCache()` from `resetMcpCache()` in `src/mcp.ts`
