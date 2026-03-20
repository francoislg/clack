## MODIFIED Requirements

### Requirement: Tool Label Registry
The system SHALL load tool label mappings from JSON config files in `data/default_configuration/tool_mapping/` (shipped defaults) and `data/configuration/tool_mapping/` (user overrides), resolving labels through template interpolation with tool arguments.

#### Scenario: Known tool mapped to label
- **WHEN** a tool call is made for a tool with a config entry (e.g., `Read`, `Grep`, `mcp__clack__git_log`)
- **THEN** the task card title uses the configured label template, interpolated with tool arguments (e.g., "Reading config.ts", "Searching codebase", "Reading git history")

#### Scenario: Dynamic label from tool arguments
- **WHEN** a tool call includes arguments that provide context (e.g., `Read` with `file_path`)
- **THEN** the label template interpolates argument values (e.g., "Reading config.ts") with path shortened to last 2 segments

#### Scenario: GitHub MCP tools
- **WHEN** a tool call is prefixed with `mcp__github__`
- **AND** the tool is listed in the GitHub config file
- **THEN** the task card title SHALL use the configured label
- **WHEN** the tool is not listed but the config has a `default` or `group`
- **THEN** the task card title SHALL use the default label or group title

#### Scenario: Null label excludes tool
- **WHEN** a tool is listed in the `hidden` array of its server's config file (e.g., `submit_response`, `report_status`)
- **THEN** no task card is created and the thinking task title is not updated

#### Scenario: Unknown tool gets generic label
- **WHEN** Claude calls a tool not in any config file and not matching any MCP server prefix
- **THEN** the task card title SHALL be "Running {toolName}"

#### Scenario: Unknown MCP tool gets server-level fallback
- **WHEN** Claude calls a tool matching `mcp__<server>__<tool>` but no config file exists for that server
- **THEN** the task card title SHALL be "Checking {Server}" with the server name capitalized

#### Scenario: Tool details from config-driven links
- **WHEN** a tool entry has a `link` field that resolves to a valid URL
- **THEN** the task card details SHALL include a clickable Slack link derived from the URL
- **AND** Clack-specific details (channel links, message links) SHALL use hardcoded logic

#### Scenario: Grouped tool details updated on re-emit
- **WHEN** an MCP tool emits `tool_progress` (empty args) followed by `tool_use` (real args)
- **AND** the tool is part of a group
- **THEN** the group's details SHALL be updated with the interpolated label and link from the real args
