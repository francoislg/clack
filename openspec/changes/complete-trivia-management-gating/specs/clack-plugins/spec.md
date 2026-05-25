## MODIFIED Requirements

### Requirement: ClackSdk Interface

The system SHALL provide a `ClackSdk` interface with methods for instruction registration, tool registration, and scoped file I/O.

#### Scenario: addInstruction method
- **WHEN** a plugin calls `sdk.addInstruction("user", "instructions", content)`
- **THEN** the SDK stores the content as a virtual default file
- **AND** the filename is automatically prefixed with the plugin name and double underscore (e.g., `trivia__instructions.md`)
- **AND** the plugin does not need to know about the prefix convention

#### Scenario: registerTool method (always-available)
- **WHEN** a plugin calls `sdk.registerTool("dev", toolDefinition, mapping)` (no options object)
- **THEN** the SDK records the tool with its minimum role requirement
- **AND** the tool is only included in queries where the user's role meets or exceeds the minimum
- **AND** the tool is always present in the catalog regardless of `session.attachedIntegrations`

#### Scenario: registerTool method with topic gating
- **WHEN** a plugin calls `sdk.registerTool("admin", toolDefinition, mapping, { topic: "trivia_management" })`
- **THEN** the SDK records the tool with its minimum role requirement AND its topic
- **AND** the tool is included in the catalog only when both gates pass: (a) the user's role meets or exceeds `minRole`, AND (b) the topic name is present in `session.attachedIntegrations`
- **AND** the tool mapping is registered the same way as for the no-options form

#### Scenario: readFile method scoped to plugin data directory
- **WHEN** a plugin calls `sdk.readFile("scores.json")`
- **THEN** the SDK resolves the path to `data/plugins/{pluginName}/scores.json`
- **AND** returns the file content as a string, or `null` if the file does not exist

#### Scenario: writeFile method scoped to plugin data directory
- **WHEN** a plugin calls `sdk.writeFile("scores.json", content)`
- **THEN** the SDK writes the content to `data/plugins/{pluginName}/scores.json`
- **AND** creates the plugin data directory if it does not exist

#### Scenario: Path traversal rejected
- **WHEN** a plugin calls `sdk.readFile("../other-plugin/data.json")`
- **THEN** the SDK rejects the call with an error
- **AND** does not access files outside the plugin's data directory

## ADDED Requirements

### Requirement: Plugin Tool Topic Gating

The system SHALL filter plugin-registered tools by topic membership at tool-catalog assembly time. A tool registered with `{ topic }` in its options SHALL be included in the assembled catalog only when the session's `attachedIntegrations` list contains the topic name. A tool registered without `{ topic }` SHALL be included whenever the role gate passes, regardless of attachment state.

The topic filter SHALL be applied alongside the existing role filter in the same per-tool loop in the tool server assembly path. Both filters MUST pass for a tool to be included.

#### Scenario: Topic-gated tool hidden without attach
- **GIVEN** a plugin registers a tool via `sdk.registerTool("admin", toolDef, mapping, { topic: "foo" })`
- **AND** an admin session has `attachedIntegrations: []`
- **WHEN** the tool server assembles the catalog
- **THEN** the tool is absent from the catalog

#### Scenario: Topic-gated tool visible after attach
- **GIVEN** a plugin registers a tool via `sdk.registerTool("admin", toolDef, mapping, { topic: "foo" })`
- **AND** an admin session has `attachedIntegrations: ["foo"]`
- **WHEN** the tool server assembles the catalog
- **THEN** the tool is present in the catalog

#### Scenario: Multiple topics with mixed attachment
- **GIVEN** a plugin registers `tool_a` via `registerTool("admin", ..., { topic: "foo" })`, `tool_b` via `registerTool("admin", ..., { topic: "bar" })`, and `tool_c` via `registerTool("admin", ...)` (no options)
- **AND** an admin session has `attachedIntegrations: ["foo"]`
- **WHEN** the tool server assembles the catalog
- **THEN** `tool_a` is present, `tool_b` is absent, and `tool_c` is present

#### Scenario: Role gate still applies when topic is attached
- **GIVEN** a plugin registers a tool via `sdk.registerTool("admin", toolDef, mapping, { topic: "foo" })`
- **AND** a `dev`-role session has `attachedIntegrations: ["foo"]`
- **WHEN** the tool server assembles the catalog
- **THEN** the tool is absent (role gate fails even though topic gate passes)

#### Scenario: Session without attachedIntegrations array treated as empty
- **GIVEN** a session whose persisted record has no `attachedIntegrations` field
- **AND** plugins have registered topic-gated tools
- **WHEN** the tool server assembles the catalog
- **THEN** no topic-gated tools are included
- **AND** non-topic-gated tools are included normally

### Requirement: Plugin-Declared Integration Catalog Entries

The system SHALL allow plugins to declare catalog-only virtual integrations via `sdk.registerTopic(name, { description, alwaysLoad? })`. The contract mirrors `sdk.reconcileCronJobs(ownerKey, specs)` — the plugin types the full integration name as a string; the SDK does not auto-prefix or validate the shape of `name`. By convention plugins SHOULD use `<pluginName>:<key>` (e.g., `trivia:management`) to self-document ownership and avoid cross-plugin collisions.

Plugin-contributed integrations SHALL be merged into the effective MCP registry at boot, so `attach_integration(name)` validates and the entry appears in the system-prompt integration catalog. Plugin-declared integrations are catalog-only — they have no MCP server config, so `loadMcpServer(name)` returns `undefined` and `attach_integration` takes the instructions-only branch.

#### Scenario: Plugin registers an integration
- **WHEN** a plugin calls `sdk.registerTopic("trivia:management", { description: "Manage trivia games. Admin only.", alwaysLoad: false })`
- **THEN** the SDK records the contribution on the plugin's `PluginLoadResult`
- **AND** at boot, the effective MCP registry contains an entry for `trivia:management` with the supplied description and `alwaysLoad: false`

#### Scenario: Plugin-declared integration is attachable
- **GIVEN** the trivia plugin has called `sdk.registerTopic("trivia:management", ...)`
- **AND** there is no `trivia:management` entry in `data/config.json` `mcpServers`
- **WHEN** Claude calls `attach_integration({ name: "trivia:management" })`
- **THEN** the call validates (no "Unknown integration" error)
- **AND** the attach takes the instructions-only branch (no MCP server is started)
- **AND** the session's `attachedIntegrations` list contains `"trivia:management"`

#### Scenario: Plugin-declared integration appears in the system-prompt catalog
- **GIVEN** the trivia plugin has called `sdk.registerTopic("trivia:management", { description: "X", alwaysLoad: false })`
- **WHEN** the system prompt is assembled for a new session
- **THEN** the AVAILABLE INTEGRATIONS catalog includes a line `- trivia:management — X`

#### Scenario: Last-write-wins on duplicate registration
- **GIVEN** plugin A calls `sdk.registerTopic("shared:foo", { description: "from A" })`
- **AND** plugin B calls `sdk.registerTopic("shared:foo", { description: "from B" })`
- **WHEN** the effective registry is resolved
- **THEN** one of the two descriptions is used (resolver behavior, not SDK-enforced)
- **AND** a warning is logged identifying the duplicate and both plugins
