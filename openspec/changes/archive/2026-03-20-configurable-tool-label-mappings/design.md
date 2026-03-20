## Context

Tool labels are the human-readable text shown in Slack task cards during Claude queries (e.g., "Reading src/config.ts", "Checking GitHub"). Today, all label mappings are hardcoded in `src/streaming/toolLabels.ts` across four separate `Record<string, LabelEntry>` maps plus a prefix fallback array. This works for known MCP servers but provides no way for users to add labels for custom servers or override defaults.

The project already has a two-tier configuration pattern for instruction files: shipped defaults in `data/default_configuration/` and user overrides in `data/configuration/` (gitignored). Tool label mappings will follow this same pattern.

## Goals / Non-Goals

**Goals:**
- All tool labels driven by JSON config files, not hardcoded maps
- Users can add label configs for custom MCP servers without code changes
- Users can override shipped defaults for existing servers
- Template interpolation for dynamic labels (file paths, search patterns, IDs)
- Safe rendering of user-provided templates in Slack (sanitization, truncation)
- Two-layer test coverage: template engine unit tests + shipped config validation

**Non-Goals:**
- File watcher for hot-reload of mapping files (restart required; acceptable for now)
- Merge semantics for overrides (full file replacement only)
- Admin UI for editing tool mappings (can be added later via Home Tab)

## Decisions

### 1. File naming convention: server name maps to filename

Each JSON file in `tool_mapping/` is named after the MCP server: `github.json` handles `mcp__github__*` tools. The special `_builtins.json` handles non-MCP tools (Read, Glob, etc.) that have no `mcp__` prefix.

**Why:** Direct, unambiguous mapping. No need for a registry or manifest file. Adding a server means adding one file.

**Alternative considered:** Single monolithic `tool_labels.json` — rejected because it would make overrides all-or-nothing across all servers.

### 2. Template interpolation with fallback chains

Templates use `{argName}` syntax with `|`-separated fallback chains: `{description|command|Running command}`. Each segment is tried left-to-right: `\w+` segments are treated as arg lookups, everything else is a literal fallback.

**Why:** Covers most dynamic label patterns without a full expression language. The existing Bash label (`description || command || "Running command"`) maps directly to `{description|command|Running command}`.

**Alternative considered:** Handlebars-style `{{#if}}` blocks — rejected as overkill for label strings. The fallback chain covers all current cases.

### 3. Full file replacement for overrides (no merging)

If `data/configuration/tool_mapping/github.json` exists, it completely replaces the default. No deep merging of `tools`, `hidden`, `groups`, etc.

**Why:** Consistent with the instruction file override pattern. Merging would introduce complex rules (what happens when user adds to `hidden` but wants to keep default `tools`?). JSON files are short enough that copying the default is low-friction.

### 4. `itemDetail` as an optional separate template

Tool entries can include an `itemDetail` field for the short description shown inside a collapsed group. If omitted, the full interpolated label is used as the item detail.

**Why:** The current `getToolGroup()` returns stripped-down details (e.g., just `"src/index.ts"` instead of `"Reading src/index.ts"`). A separate template preserves this precision without hacky string manipulation. Most tools don't group, so the field is optional.

### 5. Cache invalidation via `resetMcpCache()`

The tool mapping cache is invalidated whenever `resetMcpCache()` is called (which fires on `mcp.json` or `.env` changes). No separate file watcher for `tool_mapping/` directories.

**Why:** MCP config changes (new servers) are the primary reason tool mappings would need reloading. For edits to existing mapping files, restarting the app is acceptable — this is an admin-level config change, not a runtime operation.

### 6. Arg extractors for virtual args

MCP servers pass args in unpredictable shapes — Sentry provides `issueUrl` instead of `issueId`, Statsig nests IDs under `params.path_id`. Rather than forcing complex expressions into template strings, a top-level `extract` block in the config derives virtual args before interpolation.

**Why:** Keeps templates clean (`{issueId}` instead of inline regex). Extractors are defined once per server, not per tool. Real args always win — extractors only fill in missing values.

**Alternative considered:** Inline regex in templates (`{issueUrl:/issues/(\d+)/}`) — rejected because it's hard to read in JSON and couples transformation with display.

### 7. Config-driven tool links

Tool entries support an optional `link` field — a template that resolves to a URL. When present, `getToolDetails()` produces a Slack mrkdwn clickable link with auto-derived text (last 2 path segments). This replaces the previous hardcoded PR link and issue link logic for GitHub and Sentry.

**Why:** Generic mechanism — any MCP server can define links. Users can add links for custom servers. No code changes needed.

**Alternative considered:** Keeping `getToolDetails()` fully hardcoded per-server — rejected because it contradicts the goal of making everything config-driven.

### 8. Dot-notation for nested args

Templates support `{params.path_id}` to traverse nested arg objects. This handles MCP servers that wrap parameters in container objects (e.g., Statsig's `{ params: { path_id: "..." } }`).

**Why:** Simple, intuitive syntax. Complements extractors — dot-notation for simple access, extractors for regex transformation.

### 9. Bash label simplification

The current Bash label wraps the command in backticks: `` Running `npm install` ``. The config-driven version simplifies to `{description|Running command}`, dropping the backtick wrapping and the command fallback.

**Why:** The `description` field is almost always present for Bash calls from Claude. Backtick formatting in template strings adds complexity (need escaping rules) for minimal benefit. If description is missing, "Running command" is an acceptable fallback.

## Risks / Trade-offs

**[Risk] Shipped config JSON has a syntax error** → Mitigated by Layer 2 tests that parse and validate every shipped config file. Also, malformed JSON in a single file only affects that server's tools — others still work.

**[Risk] User override file has invalid schema** → The loader logs a warning and skips the file, falling back to the default for that server. The generic MCP fallback ("Checking {Server}") still applies for completely unmapped tools.

**[Risk] Template injection via tool args** → Mitigated by sanitization rules: only `\w+` recognized as arg refs, values stripped of `<>@!` and newlines, truncated to 40 chars. Final label truncated to 80 chars.

**[Trade-off] Full file replacement means users must copy defaults to override a single tool** → Acceptable given the simplicity benefit. Config files are short (10-30 entries). Can revisit if users complain.

**[Trade-off] No hot-reload for mapping file edits** → Acceptable for a power-user config. MCP config changes already trigger cache invalidation, covering the most common scenario (adding a new server).
