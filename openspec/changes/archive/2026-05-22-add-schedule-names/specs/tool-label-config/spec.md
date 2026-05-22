## ADDED Requirements

### Requirement: Per-Tool Args Enricher Hook

The tool-mapping loader SHALL expose a process-global registry that lets call-site code register a synchronous arg-enricher function for a fully-qualified MCP tool name (e.g. `"mcp__clack__cancel_scheduled_message"`). Registered enrichers SHALL run on the tool's args before `applyArgConfigs` interpolates the label template, allowing the loader to surface synthetic args (e.g. `name` looked up from external state) that Claude did not directly pass to the tool.

The hook SHALL be:

- **Synchronous.** Enricher functions accept `(args: Record<string, unknown>) => Record<string, unknown>` and SHALL NOT perform async I/O.
- **Composable.** Multiple enrichers MAY be registered for the same tool name and SHALL run in registration order; each enricher receives the output of the previous one.
- **Defensive.** When an enricher throws, the system SHALL log a warning and fall back to the un-enriched args; label generation SHALL NOT crash.
- **Idempotent on registration.** Registering the same function for the same tool name twice SHALL produce a single registration.

A test-only escape hatch `clearArgEnrichers()` SHALL be available to reset the registry between unit tests.

#### Scenario: Registered enricher augments args before interpolation

- **GIVEN** an enricher registered for `"mcp__clack__cancel_scheduled_message"` that returns `{ ...args, name: "Morning roundup" }` when `args.id` matches a known job
- **AND** the label template is `"Cancelling scheduled message {name|id}"`
- **WHEN** the tool fires with `{ id: "abc123" }`
- **THEN** the rendered label is `"Cancelling scheduled message Morning roundup"`

#### Scenario: Enricher with no match preserves fallback chain

- **GIVEN** an enricher registered for `"mcp__clack__cancel_scheduled_message"` that returns `args` unchanged when no job matches
- **AND** the label template is `"Cancelling scheduled message {name|id}"`
- **WHEN** the tool fires with `{ id: "unknown" }`
- **THEN** the rendered label is `"Cancelling scheduled message unknown"` (the `{name|id}` fallback resolves to `id`)

#### Scenario: Throwing enricher does not crash label rendering

- **GIVEN** an enricher registered for `"mcp__foo__bar"` that throws on any input
- **WHEN** the tool fires with any args
- **THEN** the label is generated from the un-enriched args
- **AND** a warning is logged

#### Scenario: Multiple enrichers compose in registration order

- **GIVEN** two enrichers registered for `"mcp__clack__cancel_scheduled_message"`: the first adds `{ name }`, the second adds `{ extra }`
- **WHEN** the tool fires with `{ id: "abc" }`
- **THEN** the args passed to label interpolation contain both `name` and `extra`

#### Scenario: clearArgEnrichers resets the registry

- **GIVEN** an enricher registered for `"mcp__foo__bar"`
- **WHEN** `clearArgEnrichers()` is called
- **AND** the tool fires
- **THEN** the args reach the interpolator unchanged
