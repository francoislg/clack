## Why

When Claude calls MCP tools, the Agent SDK stages results as temp files (`tool-results/mcp-<server>-<tool>-<id>`), then Claude calls `Read` to consume them. These `Read` calls show up in Slack task cards as noise — either as standalone "Reading tool-results/..." items or folded into "Searching codebase" groups alongside real code reads. They're SDK plumbing, not meaningful user-facing work. Users need a config-driven way to conditionally hide tool calls based on argument values.

## What Changes

- Add a `conditionalHidden` config key to the tool mapping config schema, supporting pattern-based hiding rules
- Each rule matches a tool name + argument name + regex pattern — when all match, the tool call is hidden from task cards
- Ship a default rule in `_builtins.json` that hides `Read` calls targeting `tool-results/` paths
- Update the `create-tool-mapping` skill to document the new feature

## Capabilities

### New Capabilities
- `conditional-hidden-rules`: Pattern-based conditional hiding of tool calls in task cards, configured via `conditionalHidden` rules in tool mapping JSON files.

### Modified Capabilities
- `streaming-responses`: The "Null label excludes tool" scenario expands — tools can now be excluded not just by name (`hidden`) but also by argument patterns (`conditionalHidden`).

## Impact

- **Config types**: `ToolMappingConfig` and `ResolvedToolMapping` in `src/streaming/toolMappingLoader.ts` gain `conditionalHidden` field
- **Label resolution**: `getToolLabel()` in `src/streaming/toolLabels.ts` checks `conditionalHidden` rules after exact-name `hidden` check
- **Shipped config**: `data/default_configuration/tool_mapping/_builtins.json` gets a default rule
- **Tests**: New unit tests for conditional hiding (pattern match, no match, missing arg, multi-rule)
- **Skill**: `.claude/skills/create-tool-mapping/SKILL.md` updated with `conditionalHidden` documentation
