## ADDED Requirements

### Requirement: Tool Mapping Config File Format
The system SHALL load tool label mappings from JSON config files in `tool_mapping/` directories. Each file represents one MCP server (filename = server name, e.g., `github.json` for `mcp__github__*` tools). The special `_builtins.json` handles non-MCP tools with no `mcp__` prefix.

Each config file SHALL support the following fields:
- `tools`: `Record<string, string | { label: string; group?: string; itemDetail?: string; link?: string }>` — per-tool label templates
- `default`: fallback label template for tools not listed in `tools`
- `hidden`: `string[]` — tool names excluded from task cards (label resolves to null)
- `group`: shorthand for single-group files — all tools share one group with this value as the title
- `groups`: `Record<string, string>` — group key to display title mapping for multi-group files
- `extract`: `Record<string, { from: string; pattern?: string }>` — virtual args derived from real args via aliasing or regex extraction

#### Scenario: Simple config with static labels
- **WHEN** a config file contains `{ "tools": { "get_items": "Reading items" } }`
- **THEN** the tool `get_items` for that server SHALL resolve to label "Reading items"

#### Scenario: Config with template labels
- **WHEN** a config file contains `{ "tools": { "create_item": "Creating item on {board_id}" } }`
- **AND** the tool is called with args `{ "board_id": "my-board" }`
- **THEN** the tool SHALL resolve to label "Creating item on my-board"

#### Scenario: Config with object-form tool entry
- **WHEN** a tool entry is `{ "label": "Reading {file_path|file}", "group": "search", "itemDetail": "{file_path|file}" }`
- **THEN** the label, group assignment, and item detail SHALL all be resolved from this entry

#### Scenario: Config with default fallback
- **WHEN** a config file has `"default": "Checking Monday"` and a tool is called that is not listed in `tools`
- **THEN** the tool SHALL resolve to "Checking Monday"

#### Scenario: Config with hidden tools
- **WHEN** a config file has `"hidden": ["submit_response"]` and `submit_response` is called
- **THEN** the label SHALL resolve to null (excluded from task cards)

#### Scenario: File-level group shorthand
- **WHEN** a config file has `"group": "Checking GitHub"` and no per-tool group assignments
- **THEN** all tools in that file SHALL share one group with title "Checking GitHub"

#### Scenario: Multi-group config with groups map
- **WHEN** a config file has `"groups": { "search": "Searching codebase", "edit": "Editing files" }` and tool entries reference these keys
- **THEN** each tool SHALL be assigned to the group matching its `group` field, with the title from `groups`

### Requirement: Two-Tier Config Loading
The system SHALL load tool mapping configs from two directories with user configs overriding shipped defaults. Override granularity is per-file (full replacement, no merging).

#### Scenario: Default config only
- **WHEN** `data/default_configuration/tool_mapping/github.json` exists
- **AND** no `data/configuration/tool_mapping/github.json` exists
- **THEN** the system SHALL use the default config for GitHub tools

#### Scenario: User override replaces default
- **WHEN** both `data/default_configuration/tool_mapping/github.json` and `data/configuration/tool_mapping/github.json` exist
- **THEN** the system SHALL use only the user config for GitHub tools (no merging with default)

#### Scenario: User adds new server config
- **WHEN** `data/configuration/tool_mapping/monday.json` exists with no corresponding default
- **THEN** the system SHALL load and use the user config for Monday tools

#### Scenario: No config for a server
- **WHEN** no config file exists for a given MCP server
- **THEN** the system SHALL fall back to the generic MCP label: "Checking {ServerName}" (capitalized server name)

#### Scenario: Malformed config file skipped
- **WHEN** a config file contains invalid JSON or does not match the expected schema
- **THEN** the system SHALL log a warning and skip that file
- **AND** tools for that server SHALL fall back to the generic MCP label

### Requirement: Template Interpolation
The system SHALL support `{argName}` template interpolation in label strings with `|`-separated fallback chains.

#### Scenario: Simple arg substitution
- **WHEN** a template is `"Reading {file_path}"` and args contain `{ "file_path": "/a/b/c.ts" }`
- **THEN** the result SHALL be "Reading b/c.ts" (path shortened to last 2 segments)

#### Scenario: Fallback chain with missing args
- **WHEN** a template is `"{description|command|Running command}"` and args contain `{ "command": "npm test" }`
- **THEN** the result SHALL be "npm test" (first arg missing, second arg found)

#### Scenario: Literal fallback at end of chain
- **WHEN** a template is `"{description|command|Running command}"` and args is empty
- **THEN** the result SHALL be "Running command" (all arg lookups miss, literal used)

#### Scenario: Empty string args treated as missing
- **WHEN** a template is `"{description|fallback text}"` and args contain `{ "description": "" }`
- **THEN** the system SHALL skip the empty value and try the next segment ("fallback text")
- **AND** single-word `\w+` segments are always attempted as arg lookups first; the last `\w+` segment in a multi-segment chain is used as a literal if the arg lookup fails

#### Scenario: Only word characters recognized as arg names
- **WHEN** a template segment matches `\w+`
- **THEN** it SHALL be treated as an arg name lookup
- **WHEN** a segment contains non-word characters (spaces, punctuation)
- **THEN** it SHALL be treated as a literal string

### Requirement: Label Sanitization
The system SHALL sanitize interpolated arg values to prevent Slack formatting injection and enforce length limits.

#### Scenario: Strip dangerous characters
- **WHEN** an arg value contains `<`, `>`, `@`, `!`, or newline characters
- **THEN** those characters SHALL be stripped from the interpolated value

#### Scenario: Truncate long arg values
- **WHEN** an arg value exceeds 40 characters
- **THEN** it SHALL be truncated to 40 characters total (39 characters + ellipsis)

#### Scenario: Shorten paths
- **WHEN** an interpolated arg value contains `/` and has more than 2 path segments
- **THEN** it SHALL be shortened to the last 2 path segments

#### Scenario: Truncate final label
- **WHEN** the fully interpolated label exceeds 80 characters
- **THEN** it SHALL be truncated to 80 characters total (79 characters + ellipsis)

### Requirement: Config Caching and Invalidation
The system SHALL cache loaded tool mapping configs and invalidate the cache when MCP configuration changes.

#### Scenario: Configs cached after first load
- **WHEN** tool mappings are loaded for the first time
- **THEN** the result SHALL be cached in memory
- **AND** subsequent calls SHALL return the cached result without re-reading files

#### Scenario: Cache invalidated on MCP reset
- **WHEN** `resetMcpCache()` is called (triggered by `mcp.json` or `.env` changes)
- **THEN** the tool mapping cache SHALL also be invalidated
- **AND** the next tool label lookup SHALL reload configs from disk

### Requirement: Group Resolution
The system SHALL resolve tool group information from config, supporting both file-level group shorthand and per-tool group assignments.

#### Scenario: Per-tool group with itemDetail
- **WHEN** a tool entry has `{ "label": "Reading {file_path|file}", "group": "search", "itemDetail": "{file_path|file}" }`
- **AND** the config has `"groups": { "search": "Searching codebase" }`
- **THEN** `getToolGroup()` SHALL return `{ key: "search", title: "Searching codebase", itemDetail: "<interpolated itemDetail>" }`

#### Scenario: Per-tool group without itemDetail defaults to label
- **WHEN** a tool entry has a `group` but no `itemDetail`
- **THEN** `getToolGroup()` SHALL use the full interpolated label as the `itemDetail`

#### Scenario: File-level group applies to all tools
- **WHEN** a config has `"group": "Checking GitHub"` (file-level) and a tool has no per-tool group
- **THEN** `getToolGroup()` SHALL return a group with the filename as the key and "Checking GitHub" as the title

#### Scenario: No group configured
- **WHEN** a tool has no per-tool group and the config has no file-level group
- **THEN** `getToolGroup()` SHALL return null

### Requirement: Arg Extraction
The system SHALL support an `extract` block in config files that derives virtual args from real args. Extractors run before template interpolation. Real args always take precedence over extracted values.

#### Scenario: Regex extraction from a URL arg
- **WHEN** a config has `"extract": { "issueId": { "from": "issueUrl", "pattern": "/issues/(\\d+)" } }`
- **AND** the tool is called with `{ "issueUrl": "https://org.sentry.io/issues/7313838390/" }`
- **THEN** the virtual arg `issueId` SHALL be set to `"7313838390"` (capture group 1)
- **AND** templates referencing `{issueId}` SHALL resolve to `"7313838390"`

#### Scenario: Aliasing a nested arg without regex
- **WHEN** a config has `"extract": { "id": { "from": "params.path_id" } }`
- **AND** the tool is called with `{ "params": { "path_id": "my-gate" } }`
- **THEN** the virtual arg `id` SHALL be set to `"my-gate"`

#### Scenario: Real args take precedence over extracted values
- **WHEN** an extractor defines `"issueId"` extracted from `"issueUrl"`
- **AND** the tool args already contain `{ "issueId": "real-id" }`
- **THEN** the real `issueId` value SHALL be used, and the extractor SHALL NOT override it

#### Scenario: Extraction skipped when source is missing
- **WHEN** an extractor references a source arg that is not present in the tool args
- **THEN** the virtual arg SHALL not be created
- **AND** template interpolation SHALL proceed without it (falling through to next segment or literal)

#### Scenario: Extraction skipped when regex doesn't match
- **WHEN** an extractor's regex pattern does not match the source arg value
- **THEN** the virtual arg SHALL not be created

### Requirement: Config-Driven Tool Links
The system SHALL support a `link` field on tool entries that resolves to a clickable Slack link in the task card details.

#### Scenario: Link from a URL arg
- **WHEN** a tool entry has `{ "label": "Reading issue", "link": "{issueUrl}" }`
- **AND** the tool is called with `{ "issueUrl": "https://sentry.io/issues/123/" }`
- **THEN** `getToolDetails()` SHALL return a Slack mrkdwn link `<url|label>` with the URL and auto-derived link text

#### Scenario: Link constructed from multiple args
- **WHEN** a tool entry has `{ "label": "Reading PR", "link": "https://github.com/{owner}/{repo}/pull/{pullNumber}" }`
- **AND** the tool is called with `{ "owner": "org", "repo": "my-repo", "pullNumber": 42 }`
- **THEN** `getToolDetails()` SHALL return a Slack mrkdwn link to the constructed URL

#### Scenario: Link suppressed when args are missing
- **WHEN** a link template produces a URL with empty path segments (unresolved placeholders)
- **THEN** `getToolDetails()` SHALL return null

#### Scenario: Link text auto-derived from URL
- **WHEN** a link URL is resolved
- **THEN** the link text SHALL be the last 2 non-empty path segments of the URL (e.g., `pull/42`, `issues/123`)

### Requirement: Dot-Notation Arg Access
The system SHALL support dot-notated arg paths in template placeholders for accessing nested arg values.

#### Scenario: Nested arg access
- **WHEN** a template contains `{params.path_id}` and args are `{ "params": { "path_id": "value" } }`
- **THEN** the system SHALL traverse the nested structure and resolve to `"value"`

#### Scenario: Missing intermediate key
- **WHEN** a template contains `{params.path_id}` and args are `{ "params": {} }`
- **THEN** the lookup SHALL fail gracefully and try the next fallback segment
