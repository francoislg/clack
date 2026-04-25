---
name: create-tool-mapping
description: >
  Create or update a tool mapping config file that controls how MCP tool calls
  display in Slack task cards. Discovers tool parameters via dump script, writes
  JSON config with label templates, validates with tests. Use this skill whenever:
  adding a new MCP server and want tool labels, updating labels for an existing
  server, tool calls showing as "Checking Servername" instead of useful labels,
  the user mentions tool mapping/labels/display names for MCP tools, or asks
  how tools appear in Slack.
---

# Create Tool Mapping

Create a tool mapping config file that controls how MCP tool calls are displayed in Slack task cards. These labels turn opaque tool names like `mcp__sentry__get_issue_details` into readable status updates like "Reading Sentry issue 7313838390".

**Input**: The argument after `/create-tool-mapping` names the MCP server (e.g., `monday`, `linear`, `jira`). If omitted, ask the user which server to map.

---

## Step 1: Study existing mappings

Before writing anything, read 2-3 existing configs to understand the patterns in use:

```
data/default_configuration/tool_mapping/
```

| File | Pattern | When to study |
|------|---------|---------------|
| `_builtins.json` | Per-tool groups, fallback chains | Always — shows the core template syntax |
| `github.json` | File-level group, Slack mrkdwn links | When the server has many related tools |
| `sentry.json` | Arg extraction via regex | When useful data is buried inside another arg |
| `statsig.json` | Nested arg aliasing | When args use nested structures like `params.path_id` |
| `clack.json` | Hidden tools, dynamic labels | When some tools shouldn't show in task cards |

User overrides live in `data/configuration/tool_mapping/` (same filename fully replaces the default). Write new configs to `data/default_configuration/tool_mapping/` — these ship with the app.

### Sharing one mapping across several MCP servers

By default the runtime looks up `mcp__<serverName>__<tool>` against `<serverName>.json`. When two or more servers run the same underlying integration in different environments (e.g. `mongodb-dev` + `mongodb-prod`, `metabase-staging` + `metabase-prod`), let them share a single mapping file via the `toolMapping` field on each server's `config.json` registry entry:

```jsonc
// data/config.json
"mcpServers": {
  "mongodb-dev":  { "alwaysLoad": false, "description": "...", "toolMapping": { "name": "mongodb", "label": "dev"  } },
  "mongodb-prod": { "alwaysLoad": true,  "description": "...", "toolMapping": { "name": "mongodb", "label": "prod" } }
}
```

- `toolMapping.name` redirects the lookup to `<name>.json` (e.g. both servers above use `mongodb.json`).
- `toolMapping.label` is appended as a `(suffix)` to the **group banner and the `default` fallback only** — `"Checking MongoDB"` becomes `"Checking MongoDB (prod)"`. Per-tool labels like `"Querying users.accounts"` render unchanged: the group title already carries the environment, so repeating it on every sub-item would just be noise. Omit `label` if no suffix is needed at all.
- Group keys are namespaced per wire server, so dev and prod task cards never collapse together even though they share a mapping file.

When you would otherwise create two near-identical mapping files that differ only by an environment word, prefer one shared file plus `toolMapping.label` instead. Schema and validation live in `src/config.ts` (`McpServerRegistryEntry`); resolution lives in `src/streaming/toolMappingLoader.ts` (`loadServerOverrides`) and `src/streaming/toolLabels.ts`.

---

## Step 2: Discover tool parameters

Run the dump script to get the server's tool names and input schemas:

```bash
npx tsx scripts/dump-mcp-tools.ts <server-name>
```

This connects to the MCP server defined in `data/mcp.json`, calls `tools/list`, and prints every tool with its parameters. Required params are marked with `*`. Use `--json` for machine-readable output.

If the server isn't running or not in `data/mcp.json`, tell the user and stop.

**Save the output** — you need the tool names and parameter names to write templates.

For servers with many tools (30+), focus on the most commonly used ones first. You can always add more later — tools without explicit labels fall back to `default` or the generic "Checking Servername".

---

## Step 3: Plan the mapping

Analyze the tool list and decide:

1. **Which tools get labels** — most tools should. Internal/meta tools that aren't user-visible steps go in `hidden`.
2. **Which args to interpolate** — pick the arg that best identifies *what* is being acted on (an ID, name, query, URL). Prefer short identifiers over descriptions.
3. **Whether tools should be grouped** — if the server has many tools typically called in bursts (e.g., multiple GitHub API calls for one PR), group them. If tools are diverse and called independently, skip grouping.
4. **Whether arg extraction is needed** — if useful info is buried inside another arg (e.g., an issue ID inside a URL, or nested in `params.path_id`), plan `argOptions`.

---

## Step 4: Write the config file

Create `data/default_configuration/tool_mapping/<server-name>.json`. If this server is one of several environments of the same integration, use the shared filename (e.g. `mongodb.json`) and wire each server to it via `toolMapping.name` in `data/config.json` — see Step 1.

**Important**: Tool names in the config use the **raw name without the MCP prefix**. The runtime strips `mcp__<server>__` automatically. So for a tool called `mcp__monday__get_board`, the config key is just `get_board`.

### Config schema

```jsonc
{
  // Per-arg behavior: extraction, truncation (optional)
  "argOptions": {
    "<argName>": {
      "from": "<sourceArg>",          // Extract from another arg (dot-notation OK: "params.path_id")
      "pattern": "<regex>",           // Capture group 1 becomes the value
      "truncate": 40                  // Max display length for this arg
    }
  },

  // Tool name → label template (or object with group info)
  "tools": {
    "<toolName>": "Static label",
    "<toolName>": "Dynamic label {argName}",
    "<toolName>": {
      "label": "Label template {arg}",
      "group": "<groupKey>",          // Assign to a named group
      "itemDetail": "{arg|fallback}"  // Shown as sub-item when grouped
    }
  },

  // Named group titles (required when tools reference groups via "group" key)
  "groups": {
    "<groupKey>": "Group display title"
  },

  // File-level group shorthand — ALL tools share one group (use instead of per-tool groups)
  "group": "Checking <ServerName>",

  // Fallback label for tools not listed in "tools" (optional)
  "default": "Checking <ServerName>",

  // Tools excluded from task cards entirely (optional)
  "hidden": ["internal_tool_1", "internal_tool_2"],

  // Pattern-based conditional hiding — hide tool calls when an arg matches a regex (optional)
  "conditionalHidden": [
    { "tool": "<toolName>", "arg": "<argName>", "pattern": "<regex>" }
  ]
}
```

### Template syntax

Labels use `{argName}` placeholders that interpolate with tool call args at runtime.

**Fallback chains**: `{arg1|arg2|literal fallback}` — tries each segment left-to-right:
- `\w+` segments are treated as arg name lookups
- `\w+(\.\w+)+` segments are dot-path lookups into nested args
- Anything else is a literal string
- The last segment in a multi-segment chain is used as a literal fallback when all lookups fail

Examples:
```
"Reading {file_path|file}"           → "Reading src/index.ts" or "Reading file"
"{description|Running command}"      → "Install deps" or "Running command"
"Reading gate {id|name|…}"          → "Reading gate my-gate" or "Reading gate …"
```

**Slack mrkdwn links**: Embed `<url|text>` links directly in templates for clickable references:
```
"Reading <https://github.com/{owner}/{repo}/pull/{pr}|PR #{pr}>"
```
Broken links from missing args are automatically cleaned up — empty URL/text is stripped, and URLs with `//` from missing segments fall back to just the text portion.

**Sanitization**: Interpolated arg values are automatically:
- Stripped of `<`, `>`, `@`, `!`, newlines (Slack injection prevention)
- Path-shortened to last 2 segments (for values containing `/`)
- Truncated per `argOptions.truncate` (if configured)
- URLs (starting with `http`) skip shortening and truncation

### argOptions

Use `argOptions` when the arg you want to display isn't directly available as a top-level tool parameter:

**Extraction from another arg** (e.g., issue ID from a URL):
```json
"argOptions": {
  "issueId": { "from": "issueUrl", "pattern": "/issues/(\\d+)" }
}
```
Extracts capture group 1 from `issueUrl` and makes it available as `{issueId}`. Real args always take precedence — extraction only fills in args that don't already exist.

**Nested arg aliasing** (e.g., Statsig wraps IDs in `params.path_id`):
```json
"argOptions": {
  "id": { "from": "params.path_id" }
}
```

**Truncation limits** (for args that can be very long, like search queries):
```json
"argOptions": {
  "query": { "truncate": 30 },
  "description": { "truncate": 60 }
}
```

### Grouping

Tools can be grouped so consecutive calls collapse into one task card. Two approaches:

**File-level group** — every tool in the file shares one group. Use when the server is focused and tools are often called together:
```json
{
  "group": "Checking GitHub",
  "tools": { ... }
}
```

**Per-tool groups** — tools opt into named groups. Use when the server has distinct categories:
```json
{
  "tools": {
    "Read": { "label": "Reading {file_path}", "group": "search", "itemDetail": "{file_path}" },
    "Grep": { "label": "Searching \"{pattern}\"", "group": "search", "itemDetail": "\"{pattern}\"" }
  },
  "groups": {
    "search": "Searching codebase"
  }
}
```

The task card shows the group title. `itemDetail` provides context within the group (what specifically is being searched, read, etc.).

---

## Step 5: Label writing guidelines

The whole point of tool mappings is to give users immediate, specific context about what Claude is doing. Two principles matter above all else:

### Always interpolate identifying args

Every label should tell users *what specific thing* is being acted on, not just the action type. If a tool fetches a resource, the label must include the identifier — an ID, name, repo, query, URL, whatever uniquely identifies it. A generic "Reading experiment" is a wasted opportunity; `"Reading experiment {id}"` tells the user exactly what's happening.

Go through every tool's parameters from the dump output and ask: "which arg would a user want to see?" That's the one to interpolate.

### Build clickable Slack mrkdwn links whenever possible

If you can construct a URL to the resource from the tool's args, do it. Links make labels actionable — users can click through to the PR, issue, dashboard, or document directly from the task card. This is especially valuable for tools that reference external resources:

```
"Reading <https://github.com/{owner}/{repo}/pull/{pr}|PR #{pr}>"
"Reading Sentry issue <{issueUrl}|{issueId}>"
"Viewing <https://linear.app/team/{teamId}/issue/{issueId}|{issueId}>"
```

Even if some args might be missing, write the link — the cleanup logic strips broken links gracefully.

### Additional conventions

1. **Start with a verb** — "Reading", "Searching", "Creating", "Listing", "Checking"
2. **Keep labels short** — under 50 characters when args are populated
3. **Avoid dangling prepositions** — `"Reading history for {repo}"` produces "Reading history for" when repo is empty. Use `"Reading history {repo}"` instead — it trims to "Reading history"
4. **Use `…` as fallback for ID-type args** — `{id|…}` signals that info is expected but unavailable
5. **Set `default` for servers with many tools** — saves unlisted tools from the generic "Checking Servername"
6. **Hide internal tools** — anything that isn't a user-visible step (status reports, callbacks) goes in `hidden`
7. **Use `conditionalHidden` for pattern-based hiding** — when a tool should only be hidden under certain conditions (e.g., `Read` of `tool-results/` paths), use `conditionalHidden` instead of `hidden`. Each rule specifies a tool name, arg name, and regex pattern:
   ```json
   "conditionalHidden": [
     { "tool": "Read", "arg": "file_path", "pattern": "^tool-results/" }
   ]
   ```
   The shipped `_builtins.json` already hides SDK tool-result reads this way. Use this for any case where the tool itself is useful but certain invocations are noise.

---

## Step 6: Validate

### Type-check and run tests

```bash
npx tsc --noEmit && npm run test
```

The test suite in `src/streaming/toolMappingLoader.test.ts` automatically validates all shipped configs:
- Every file parses as valid JSON
- Every tool entry interpolates to a non-empty string (with both empty and generic args)
- Every tool with a `group` reference has a matching group title
- `default` labels interpolate to a non-empty string

Fix any failures and re-run.

### Manual spot-check

Pick 2-3 representative tools and trace the template interpolation:
- **All args present** → does the label look good? Are mrkdwn links valid?
- **No args** → does it degrade gracefully? No dangling prepositions, no broken links?
- **Partial args** → do broken mrkdwn links get cleaned up?

---

## Step 7: Show summary

Display:
- Config file path
- Number of tools mapped
- Number of hidden tools
- Grouping strategy (file-level / per-tool / none)
- Whether `argOptions` or `default` are used
- Sample labels: show 3-4 representative tools with example args and the resulting label
