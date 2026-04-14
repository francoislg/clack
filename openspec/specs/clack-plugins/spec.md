# clack-plugins Specification

## Purpose
TBD - created by archiving change plugin-architecture. Update Purpose after archive.
## Requirements
### Requirement: Plugin Contract

A Clack plugin SHALL be a function that receives a `ClackSdk` instance and uses it to register instructions and tools.

#### Scenario: Plugin function signature
- **WHEN** a plugin is defined
- **THEN** it is an async function accepting a single `ClackSdk` parameter
- **AND** it returns `Promise<void>`

#### Scenario: Plugin registers instructions
- **WHEN** a plugin function is called with an SDK instance
- **THEN** the plugin MAY call `sdk.addInstruction(role, filename, content)` one or more times
- **AND** each call declares a virtual instruction file for the given role tier

#### Scenario: Plugin registers tools
- **WHEN** a plugin function is called with an SDK instance
- **THEN** the plugin MAY call `sdk.registerTool(minRole, toolDefinition)` one or more times
- **AND** each call declares a tool with a minimum role requirement

### Requirement: ClackSdk Interface

The system SHALL provide a `ClackSdk` interface with methods for instruction registration, tool registration, and scoped file I/O.

#### Scenario: addInstruction method
- **WHEN** a plugin calls `sdk.addInstruction("user", "instructions", content)`
- **THEN** the SDK stores the content as a virtual default file
- **AND** the filename is automatically prefixed with the plugin name and double underscore (e.g., `trivia__instructions.md`)
- **AND** the plugin does not need to know about the prefix convention

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

### Requirement: Built-in Plugin Registry

The system SHALL maintain a registry mapping plugin names to their entry functions for built-in plugins.

#### Scenario: Registry lookup for known plugin
- **WHEN** the system loads plugins from config
- **AND** `plugins: ["trivia"]` is configured
- **THEN** the system looks up "trivia" in the built-in registry
- **AND** finds the corresponding plugin function

#### Scenario: Unknown plugin name
- **WHEN** the system loads plugins from config
- **AND** the configured name does not exist in the registry
- **THEN** the system logs a warning
- **AND** skips the unknown plugin without crashing

### Requirement: Plugin Loading Lifecycle

The system SHALL load plugins once at startup, harvesting their registrations for use during queries.

#### Scenario: Plugin loaded at startup
- **WHEN** the application starts
- **THEN** the system reads `plugins` from config
- **AND** for each enabled plugin, creates a scoped `ClackSdk` instance
- **AND** calls the plugin function
- **AND** collects the accumulated instructions and tools

#### Scenario: Plugin error does not crash startup
- **WHEN** a plugin function throws an error during loading
- **THEN** the system catches the error
- **AND** logs it with the plugin name
- **AND** continues loading remaining plugins

#### Scenario: SDK instance persists for data access
- **WHEN** a plugin has been loaded
- **THEN** the `sdk.readFile` and `sdk.writeFile` references captured in tool closures remain usable
- **AND** tool handlers can read and write plugin data throughout the application's lifetime

### Requirement: Config-Driven Activation

The system SHALL use a `plugins` array in `config.json` to control which plugins are active.

#### Scenario: Plugins field in config
- **WHEN** `config.json` contains `"plugins": ["trivia"]`
- **THEN** only the "trivia" plugin is loaded
- **AND** plugins not in the array are not loaded

#### Scenario: Empty or missing plugins field
- **WHEN** `config.json` does not contain a `plugins` field or it is an empty array
- **THEN** no plugins are loaded
- **AND** the system operates normally without plugin functionality

### Requirement: Skill-Plugins Directory Rename

The system SHALL rename `data/plugins/` (Claude Code SDK skill packs) to `data/skill-plugins/` to free the path for Clack plugin data.

#### Scenario: Migration renames directory
- **WHEN** the boot migration runs
- **AND** `data/plugins/` exists
- **AND** `data/skill-plugins/` does not exist
- **THEN** the migration renames `data/plugins/` to `data/skill-plugins/`

#### Scenario: Migration skips if already renamed
- **WHEN** the boot migration runs
- **AND** `data/skill-plugins/` already exists
- **THEN** the migration does nothing

#### Scenario: All SDK plugin references updated
- **WHEN** the migration completes
- **THEN** `discoverPluginInfo()` scans `data/skill-plugins/` instead of `data/plugins/`
- **AND** `discoverPlugins()` returns configs pointing to `data/skill-plugins/` paths
- **AND** the Home Tab displays skill packs under the label "Skill Plugins:" (renamed from "Plugins:")

### Requirement: Home Tab Plugin Display

The Home Tab SHALL display loaded Clack plugins separately from SDK skill packs.

#### Scenario: Clack plugins shown when loaded
- **WHEN** one or more Clack plugins are loaded (e.g., `plugins: ["trivia"]`)
- **THEN** the Home Tab displays a "Plugins:" section
- **AND** each plugin is listed with its name and the number of tools it registered

#### Scenario: Clack plugins section hidden when none loaded
- **WHEN** no Clack plugins are configured or loaded
- **THEN** the Home Tab does NOT display the "Plugins:" section

#### Scenario: Both sections shown independently
- **WHEN** both SDK skill packs exist in `data/skill-plugins/` and Clack plugins are loaded
- **THEN** the Home Tab displays both "Skill Plugins:" and "Plugins:" as separate sections

