## MODIFIED Requirements

### Requirement: ClackSdk Interface

The system SHALL provide a `ClackSdk` interface with methods for instruction registration, tool registration, and scoped file I/O.

#### Scenario: addInstruction method
- **WHEN** a plugin calls `sdk.addInstruction("user", "instructions", content)`
- **THEN** the SDK stores the content as a virtual default file
- **AND** the filename is automatically prefixed with the plugin name and double underscore (e.g., `trivia__instructions.md`)
- **AND** the plugin does not need to know about the prefix convention

#### Scenario: addTopicInstruction method
- **WHEN** a plugin calls `sdk.addTopicInstruction("user", "trivia", "persona", content)`
- **THEN** the SDK stores the content as a virtual default scoped to the `trivia` topic
- **AND** the virtual-default key is `topics/trivia/<pluginName>__persona.md`
- **AND** the file is loaded only when the `trivia` topic is active for a session (either pre-attached via cron `attachedTopics` or runtime-attached via `attach_integration`)
- **AND** an admin override at `data/configuration/<role>/topics/trivia/<pluginName>__persona.md` takes precedence

#### Scenario: registerTool method
- **WHEN** a plugin calls `sdk.registerTool("dev", toolDefinition)`
- **THEN** the SDK records the tool with its minimum role requirement
- **AND** the tool is only included in queries where the user's role meets or exceeds the minimum

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
