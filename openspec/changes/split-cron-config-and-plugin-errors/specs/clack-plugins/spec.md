## ADDED Requirements

### Requirement: ClackSdk Exposes Plugin Error Reporting

The `ClackSdk` interface SHALL expose `error(reason: string): void`. Plugins SHALL call this method during init to record a load-time problem. The call is non-fatal: it appends `reason` to the plugin's `errors[]` array on its `PluginLoadResult` and returns. Plugins MAY call `error()` multiple times to record multiple independent problems, and MAY continue execution after calling it (e.g. to register a partial set of tools), or `return` immediately to abort the load.

#### Scenario: Single error recorded

- **WHEN** a plugin calls `sdk.error("reason text")`
- **THEN** the SDK appends `"reason text"` to that plugin's `errors[]` array
- **AND** does not throw

#### Scenario: Multiple errors accumulate

- **WHEN** a plugin calls `sdk.error("reason A")` followed by `sdk.error("reason B")`
- **THEN** that plugin's `errors[]` contains both strings in call order

#### Scenario: Plugin continues after calling error

- **WHEN** a plugin calls `sdk.error("partial-failure reason")` and then `sdk.registerTool(...)`
- **THEN** the SDK records the error
- **AND** ALSO records the registered tool
- **AND** the plugin's `PluginLoadResult` has `errors.length > 0` AND `tools.length > 0`

### Requirement: ClackSdk Exposes Capability Flags

The `ClackSdk` interface SHALL expose `capabilities: { crons: boolean }`. Each field reflects a static-at-load-time fact about the host runtime. Plugins SHALL use these flags to decide whether they can run. The initial set contains only `crons`, which mirrors `config.cron.enabled` at the time the plugin was loaded.

#### Scenario: capabilities.crons reflects cron.enabled = true

- **GIVEN** `config.cron.enabled` is `true`
- **WHEN** a plugin's init runs
- **THEN** `sdk.capabilities.crons` is `true`

#### Scenario: capabilities.crons reflects cron.enabled = false

- **GIVEN** `config.cron.enabled` is `false`
- **WHEN** a plugin's init runs
- **THEN** `sdk.capabilities.crons` is `false`

#### Scenario: capabilities is a plain object

- **WHEN** a plugin reads `sdk.capabilities`
- **THEN** the value is a plain object with boolean fields (not a function)
- **AND** the object is safe to destructure

### Requirement: PluginLoadResult Includes Errors

The `PluginLoadResult` type SHALL include `errors: string[]`. The array SHALL accumulate every reason passed to `sdk.error()` during the plugin's init call, in call order. When the plugin's init throws an unhandled exception, the loader SHALL push a synthetic `PluginLoadResult` for that plugin with `errors: [<thrown message>]` and empty `instructions`, `tools`, `actionHandlers`, and `viewHandlers` arrays — the plugin is "present but degraded" rather than absent.

#### Scenario: Errors populated from sdk.error calls

- **GIVEN** a plugin's init calls `sdk.error("A")` and `sdk.error("B")`
- **WHEN** loading completes
- **THEN** that plugin's `PluginLoadResult.errors` equals `["A", "B"]`

#### Scenario: Unhandled throw becomes synthetic result

- **GIVEN** a plugin's init throws `new Error("boom")`
- **WHEN** loading completes
- **THEN** the loader appends a `PluginLoadResult` with `name: <plugin-name>`, `errors: ["boom"]`, `instructions: []`, `tools: []`, `actionHandlers: []`, `viewHandlers: []`
- **AND** the failing plugin is NOT silently dropped

#### Scenario: Successful plugin has empty errors

- **GIVEN** a plugin's init runs to completion without calling `sdk.error` and without throwing
- **WHEN** loading completes
- **THEN** that plugin's `PluginLoadResult.errors` is an empty array

## MODIFIED Requirements

### Requirement: Plugin Loading Lifecycle

The system SHALL load plugins once at startup, harvesting their registrations for use during queries. Errors raised intentionally via `sdk.error` or thrown unexpectedly during init SHALL surface on the plugin's `PluginLoadResult.errors`; the plugin is never silently dropped from the loaded set.

#### Scenario: Plugin loaded at startup
- **WHEN** the application starts
- **THEN** the system reads `plugins` from config
- **AND** for each enabled plugin, creates a scoped `ClackSdk` instance
- **AND** calls the plugin function
- **AND** collects the accumulated instructions, tools, and errors

#### Scenario: Plugin error does not crash startup
- **WHEN** a plugin function throws an error during loading
- **THEN** the system catches the error
- **AND** logs it with the plugin name
- **AND** records the thrown message on a synthetic `PluginLoadResult.errors`
- **AND** continues loading remaining plugins

#### Scenario: Plugin calls sdk.error then returns
- **WHEN** a plugin's init calls `sdk.error("reason")` and returns without registering tools
- **THEN** the loader records the error on the plugin's `PluginLoadResult`
- **AND** the plugin appears in the loaded set with `errors.length === 1`
- **AND** continues loading remaining plugins

#### Scenario: SDK instance persists for data access
- **WHEN** a plugin has been loaded
- **THEN** the `sdk.readFile` and `sdk.writeFile` references captured in tool closures remain usable
- **AND** tool handlers can read and write plugin data throughout the application's lifetime
