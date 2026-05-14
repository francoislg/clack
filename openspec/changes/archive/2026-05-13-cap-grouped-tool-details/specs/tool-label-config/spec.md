## MODIFIED Requirements

### Requirement: Tool Mapping Config File Format
The system SHALL load tool label mappings from JSON config files in `tool_mapping/` directories. Each file represents one MCP server (filename = server name, e.g., `github.json` for `mcp__github__*` tools). The special `_builtins.json` handles non-MCP tools with no `mcp__` prefix.

Each config file SHALL support the following fields:
- `tools`: `Record<string, string | { label: string; group?: string; itemDetail?: string; link?: string }>` — per-tool label templates
- `default`: fallback label template for tools not listed in `tools`
- `hidden`: `string[]` — tool names excluded from task cards (label resolves to null)
- `group`: shorthand for single-group files — all tools share one group with this value as the title
- `maxDetails`: optional `number` — when the file uses the `group` shorthand, caps the number of detail lines rendered for that group's task card
- `groups`: `Record<string, string | { title: string; maxDetails?: number }>` — group key to display title mapping for multi-group files; values may be a plain title string (legacy form) or an object carrying a per-group `maxDetails` override
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

#### Scenario: Multi-group config with groups map (string form)
- **WHEN** a config file has `"groups": { "search": "Searching codebase", "edit": "Editing files" }` and tool entries reference these keys
- **THEN** each tool SHALL be assigned to the group matching its `group` field, with the title from `groups`

#### Scenario: Multi-group config with object form values
- **WHEN** a config file has `"groups": { "search": "Searching codebase", "commands": { "title": "Running commands", "maxDetails": 10 } }`
- **THEN** the `commands` group SHALL resolve to title "Running commands" and the loader SHALL record a `maxDetails` override of `10` for that group key
- **AND** the `search` group (plain string form) SHALL resolve to title "Searching codebase" with no per-group `maxDetails` override

#### Scenario: File-level group with sibling maxDetails
- **WHEN** a config file has `"group": "Checking GitHub"` and `"maxDetails": 3`
- **THEN** the file-level group SHALL resolve with title "Checking GitHub" and a `maxDetails` override of `3`

#### Scenario: Clack find_emoji tool label
- **WHEN** the `find_emoji` tool is called with args `{ "query": "party" }`
- **THEN** the tool SHALL resolve to label `Looking up emoji "party"` via the `clack.json` config

### Requirement: Group Resolution
The system SHALL resolve tool group information from config, supporting both file-level group shorthand and per-tool group assignments. The resolved `ToolGroupInfo` SHALL include a `maxDetails` value derived from the layered config (per-group override → global config → built-in default).

#### Scenario: Per-tool group with itemDetail
- **WHEN** a tool entry has `{ "label": "Reading {file_path|file}", "group": "search", "itemDetail": "{file_path|file}" }`
- **AND** the config has `"groups": { "search": "Searching codebase" }`
- **THEN** `getToolGroup()` SHALL return `{ key: "search", title: "Searching codebase", itemDetail: "<interpolated itemDetail>", maxDetails: <resolved cap> }`

#### Scenario: Per-tool group without itemDetail defaults to label
- **WHEN** a tool entry has a `group` but no `itemDetail`
- **THEN** `getToolGroup()` SHALL use the full interpolated label as the `itemDetail`

#### Scenario: File-level group applies to all tools
- **WHEN** a config has `"group": "Checking GitHub"` (file-level) and a tool has no per-tool group
- **THEN** `getToolGroup()` SHALL return a group with the filename as the key and "Checking GitHub" as the title

#### Scenario: No group configured
- **WHEN** a tool has no per-tool group and the config has no file-level group
- **THEN** `getToolGroup()` SHALL return null

#### Scenario: maxDetails resolution prefers per-group override
- **WHEN** the mapping config defines `"groups": { "commands": { "title": "Running commands", "maxDetails": 10 } }`
- **AND** the global config has `"taskCards": { "maxDetailsPerGroup": 5 }`
- **THEN** `getToolGroup()` SHALL return `maxDetails: 10` for tools in the `commands` group

#### Scenario: maxDetails falls back to global config when no per-group override
- **WHEN** the mapping config defines `"groups": { "search": "Searching codebase" }` (plain string, no override)
- **AND** the global config has `"taskCards": { "maxDetailsPerGroup": 8 }`
- **THEN** `getToolGroup()` SHALL return `maxDetails: 8` for tools in the `search` group

#### Scenario: maxDetails falls back to built-in default of 5 when no config sets it
- **WHEN** neither the mapping config nor the global config sets a cap for the group
- **THEN** `getToolGroup()` SHALL return `maxDetails: 5`

## ADDED Requirements

### Requirement: Global Task Card Rendering Config
The system SHALL load an optional `taskCards` section from `data/config.json` with a `maxDetailsPerGroup: number` field that sets the default cap on detail lines rendered per grouped tool task card. This default applies to every group that does not specify its own `maxDetails` override in a tool mapping file.

#### Scenario: Global default applies when no per-group override exists
- **WHEN** `data/config.json` contains `"taskCards": { "maxDetailsPerGroup": 8 }`
- **AND** a mapping file declares `"groups": { "search": "Searching codebase" }` with no override
- **THEN** every group key without an explicit `maxDetails` SHALL resolve to a cap of `8`

#### Scenario: Built-in fallback applies when taskCards section is absent
- **WHEN** `data/config.json` does not contain a `taskCards` section
- **AND** no per-group `maxDetails` is configured
- **THEN** the resolved cap SHALL be `5`

#### Scenario: Built-in fallback applies when only maxDetailsPerGroup field is absent
- **WHEN** `data/config.json` contains `"taskCards": {}` (section present, field absent)
- **AND** no per-group `maxDetails` is configured
- **THEN** the resolved cap SHALL be `5`

#### Scenario: maxDetailsPerGroup of 0 is a valid value
- **WHEN** `data/config.json` contains `"taskCards": { "maxDetailsPerGroup": 0 }`
- **THEN** the resolved cap SHALL be `0` (no detail lines rendered for groups using this default)

#### Scenario: Negative or non-numeric values are rejected
- **WHEN** `data/config.json` contains `"taskCards": { "maxDetailsPerGroup": -1 }` or a non-number value
- **THEN** the loader SHALL log a warning and fall back to the built-in default of `5`
