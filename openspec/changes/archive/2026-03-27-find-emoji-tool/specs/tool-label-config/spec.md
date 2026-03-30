## MODIFIED Requirements

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

#### Scenario: Clack find_emoji tool label
- **WHEN** the `find_emoji` tool is called with args `{ "query": "party" }`
- **THEN** the tool SHALL resolve to label `Looking up emoji "party"` via the `clack.json` config
