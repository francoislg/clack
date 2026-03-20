## Context

The tool mapping system (introduced in `configurable-tool-label-mappings`) supports two forms of hiding: exact tool name matches via the `hidden` array, and tools not listed at all (which get a fallback label). There's no way to hide a tool conditionally based on its arguments.

The Agent SDK stages MCP tool results as temp files under `tool-results/`, then Claude calls `Read` to consume them. These `Read` calls appear in Slack task cards as noise. The `Read` tool itself shouldn't be hidden — only reads of `tool-results/` paths should be suppressed.

## Goals / Non-Goals

**Goals:**
- Allow tool calls to be conditionally hidden based on argument value patterns
- Ship a default rule suppressing SDK tool-result reads from task cards
- Keep the config surface minimal and consistent with existing patterns (`hidden`, `argOptions`)

**Non-Goals:**
- Conditional grouping (folding tool-result reads into the previous MCP tool's group) — hiding is the correct UX since the MCP tool already has its own card
- Conditional label overrides based on args (different feature, not needed here)
- Runtime-dynamic rules (all rules are static config, resolved at load time)

## Decisions

### 1. Config key: `conditionalHidden` array of rule objects

```json
{
  "conditionalHidden": [
    { "tool": "Read", "arg": "file_path", "pattern": "^tool-results/" }
  ]
}
```

Each rule has three required fields: `tool` (exact name), `arg` (which argument to test), `pattern` (regex to test against). All three must match for the tool call to be hidden.

**Why not extend `hidden`?** The `hidden` array is a flat list of tool names — clean and simple. Overloading it with objects would complicate parsing and the mental model. A separate key keeps the two concepts distinct: `hidden` = always hide by name, `conditionalHidden` = hide when args match.

**Why regex?** Consistent with `argOptions.pattern`. Supports both simple prefix checks (`^tool-results/`) and complex patterns. Pre-compiled at config load time for performance.

### 2. Evaluation order: after `hidden`, before label lookup

```
hidden (exact name)  →  conditionalHidden (arg pattern)  →  label lookup
```

If a tool is in `hidden`, skip arg checks entirely. If it matches a `conditionalHidden` rule, return null before doing any label interpolation. This avoids wasted work.

### 3. Rules scoped to their config file's server

`conditionalHidden` in `_builtins.json` applies to builtin tools. `conditionalHidden` in `metabase.json` applies to metabase tools. No cross-server rules needed — the file already determines scope.

### 4. Default shipped rule in `_builtins.json`

```json
"conditionalHidden": [
  { "tool": "Read", "arg": "file_path", "pattern": "^tool-results/" }
]
```

Hides all SDK tool-result reads out of the box. Users can override by placing their own `_builtins.json` in `data/configuration/tool_mapping/`.

## Risks / Trade-offs

- **Regex errors in user config** → Wrap compilation in try/catch, skip invalid rules with a warning (consistent with `argOptions` handling)
- **Missing arg at runtime** → Treat as empty string, pattern won't match, tool call is shown (safe default: show rather than hide)
- **Performance** → Rules are checked on every `getToolLabel` call. Pre-compiled regexes + small array (typically 1-3 rules) makes this negligible
