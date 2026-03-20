# streaming-responses Delta Spec

## MODIFIED Requirements

### Requirement: Tool Label Registry
The system SHALL maintain a mapping from tool names to human-readable labels for display in task cards.

#### Scenario: Known tool mapped to label
- **WHEN** a tool call is made for a registered tool (e.g., `Read`, `Grep`, `mcp__clack__git_log`)
- **THEN** the task card title uses the registered label (e.g., "Reading file", "Searching codebase", "Reading git history")

#### Scenario: Dynamic label from tool arguments
- **WHEN** a tool call includes arguments that provide context (e.g., `Read` with `file_path`)
- **THEN** the label includes argument details (e.g., "Reading config.ts") with path shortened to last 2 segments

#### Scenario: GitHub MCP tools
- **WHEN** a tool call is prefixed with `mcp__github__`
- **THEN** the task card title SHALL be "Checking GitHub"

#### Scenario: Null label excludes tool
- **WHEN** the registry maps a tool to `null` (e.g., `submit_response`, `report_status`)
- **OR** the tool is listed in `hidden`
- **OR** the tool matches a `conditionalHidden` rule (tool name + argument pattern match)
- **THEN** no task card is created and the thinking task title is not updated
