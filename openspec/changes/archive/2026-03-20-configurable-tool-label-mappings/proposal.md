## Why

Tool label mappings (the human-readable text shown in Slack task cards during Claude queries) are hardcoded in `src/streaming/toolLabels.ts`. When users add custom MCP servers, their tools fall through to a generic "Checking {Server}" fallback with no per-tool detail. Users should be able to configure labels for their own MCP servers — and override shipped defaults — without code changes, using the same two-tier config pattern already established for instructions.

## What Changes

- Extract all hardcoded tool label maps into JSON config files under `data/default_configuration/tool_mapping/`
- Support user overrides in `data/configuration/tool_mapping/` (full file replacement, no merging)
- Introduce a template interpolation system for dynamic labels (e.g., `"Reading {file_path|file}"`)
- Add a config loader module that caches resolved mappings and invalidates on MCP cache reset
- Rewrite `getToolLabel()` and `getToolGroup()` to use config-driven lookups instead of hardcoded maps
- `getToolDetails()` stays in code (produces Slack mrkdwn that templates shouldn't generate)

## Capabilities

### New Capabilities
- `tool-label-config`: Configurable tool label mappings loaded from two-tier JSON config files, with template interpolation for dynamic labels and support for grouping, hiding, and default fallbacks.

### Modified Capabilities
- `streaming-responses`: The "Tool Label Registry" requirement changes from hardcoded maps to config-file-driven lookups. Label resolution behavior is the same from the consumer's perspective, but the source of truth moves from code to config files.

## Impact

- **Code**: `src/streaming/toolLabels.ts` (major rewrite), new `src/streaming/toolMappingLoader.ts`, minor change to `src/mcp.ts` (cache invalidation)
- **Config files**: 5 new JSON files in `data/default_configuration/tool_mapping/`
- **Tests**: New unit tests for interpolation engine, new regression tests validating all shipped config files, existing `toolLabels.test.ts` tests must continue passing
- **User-facing**: No visible change for existing users. New capability for users with custom MCP servers.
