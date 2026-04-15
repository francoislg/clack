## ADDED Requirements

### Requirement: Plugin Tool Mappings Keyed by Plugin Server Name

The tool-mapping loader SHALL expose each plugin's tool mappings under a `ResolvedToolMapping` entry keyed by the plugin's server name (matching the plugin's dedicated MCP server name). Plugin mappings SHALL NOT be merged into the `clack` mapping.

#### Scenario: Single plugin produces its own mapping entry

- **WHEN** plugin `trivia` has registered tools with mappings via `sdk.registerTool(..., mapping)`
- **AND** the tool-mapping loader runs
- **THEN** the loader produces a `ResolvedToolMapping` entry keyed by `trivia`
- **AND** each mapping entry's tool label applies to `mcp__trivia__<toolName>` invocations during streaming and task-card rendering
- **AND** no plugin tool mappings are inserted under the `clack` key

#### Scenario: Plugin file-based config overrides plugin-registered mappings

- **WHEN** `data/configuration/tool_mapping/trivia.json` exists
- **AND** plugin `trivia` also registers programmatic mappings via the SDK
- **THEN** the file-based config takes precedence for entries it defines (consistent with existing two-tier override behavior)
- **AND** programmatic mappings fill in for tools not covered by the file-based config

#### Scenario: Two-tier override applies to plugin config files

- **WHEN** both `data/default_configuration/tool_mapping/trivia.json` and `data/configuration/tool_mapping/trivia.json` exist
- **THEN** the user-override file fully replaces the default file for plugin `trivia` (per-file replacement, no merging — identical to core-server two-tier behavior)
- **AND** programmatic SDK mappings fill in only for tool names not covered by the effective (user-override) file

#### Scenario: Missing plugin config falls back to generic MCP label

- **WHEN** a plugin tool is invoked and no mapping exists for it (neither file-based nor programmatic)
- **THEN** the label falls back to the existing generic MCP label format `"Checking {ServerName}"` where `{ServerName}` is the plugin's server name with its first character uppercased
- **AND** for example, an unmapped tool on plugin `trivia` resolves to the label `"Checking Trivia"`

#### Scenario: Core `clack` mapping unaffected by plugin loading

- **WHEN** one or more plugins are loaded
- **THEN** the `clack` mapping entry contains only core-tool mappings
- **AND** loading or unloading plugins does not mutate the `clack` mapping
