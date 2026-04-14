## MODIFIED Requirements

### Requirement: Role-Based Tool Gating

The system SHALL register tools based on the user's role, workflow configuration, feature flags, and active plugins. Plugin-registered tools are included when the user's role meets the declared minimum.

#### Scenario: Member user tool set
- **WHEN** the user has the member role in query mode
- **THEN** the tool server registers core query tools and `submit_response`
- **AND** registers `find_user`, `find_emoji`, and `upload_file` if a Slack client is available
- **AND** registers scheduling tools if `allowScheduledMessages` is enabled and a Slack client is available
- **AND** registers plugin tools where the declared minimum role is `member`
- **AND** does NOT register plugin tools with a higher minimum role

#### Scenario: Dev user tool set with plugins
- **GIVEN** the changes workflow is enabled for the trigger type
- **AND** a plugin has registered tools with minimum role `dev`
- **WHEN** the user has the dev role (or higher) in query mode
- **THEN** the tool server registers all core query tools, change tools, and `submit_response`
- **AND** registers plugin tools with minimum role `member` or `dev`
- **AND** does NOT register plugin tools with minimum role `admin` or `owner`

#### Scenario: Plugin tools not included in worker mode
- **WHEN** the tool server is built with mode `"worker"`
- **THEN** it registers only core worker tools (`git_push`, `ensure_pr`, `merge_pr`, `close_pr`, `report_status`)
- **AND** does NOT register any plugin tools
- **AND** plugin tool registration is strictly query-mode only

#### Scenario: Plugin tools included alongside core tools
- **GIVEN** plugins have registered tools
- **WHEN** the tool server is built in query mode
- **THEN** plugin tools are appended after core tools in the tools array
- **AND** all tools (core and plugin) are passed to `createSdkMcpServer()` together

#### Scenario: Duplicate tool name from plugin
- **GIVEN** a plugin registers a tool with the same name as a core tool
- **WHEN** the tool server is built
- **THEN** the system logs a warning about the duplicate
- **AND** the core tool is kept and the plugin tool is dropped (core tools take precedence)
