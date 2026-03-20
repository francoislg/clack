# conditional-hidden-rules Specification

## Purpose
Pattern-based conditional hiding of tool calls in Slack task cards, configured via `conditionalHidden` rules in tool mapping JSON config files.

## Requirements

### Requirement: Conditional Hidden Rules Config
The tool mapping config schema SHALL support a `conditionalHidden` array of rule objects, where each rule specifies a tool name, argument name, and regex pattern.

#### Scenario: Rule matches and hides tool call
- **WHEN** a tool call's name matches a `conditionalHidden` rule's `tool` field
- **AND** the tool call's argument named by the rule's `arg` field matches the rule's `pattern` regex
- **THEN** the tool call SHALL be hidden from task cards (`getToolLabel` returns null)

#### Scenario: Rule does not match — tool shown normally
- **WHEN** a tool call's name matches a rule's `tool` field
- **BUT** the argument value does not match the rule's `pattern` regex
- **THEN** the tool call SHALL be shown normally with its configured label

#### Scenario: Argument missing at runtime
- **WHEN** a tool call matches a rule's `tool` field
- **BUT** the argument named by the rule's `arg` field is not present in the tool call
- **THEN** the rule SHALL NOT match (safe default: show the tool call)

#### Scenario: Multiple rules evaluated
- **WHEN** a config file contains multiple `conditionalHidden` rules
- **THEN** rules SHALL be evaluated in order until one matches
- **AND** the first matching rule causes the tool call to be hidden

#### Scenario: Rules scoped to config file's server
- **WHEN** `conditionalHidden` is defined in a server's tool mapping config (e.g., `_builtins.json`)
- **THEN** rules SHALL only apply to tools belonging to that server

### Requirement: Evaluation Order
The `conditionalHidden` check SHALL occur after exact-name `hidden` checks and before label template lookup.

#### Scenario: Hidden takes precedence over conditionalHidden
- **WHEN** a tool is listed in both `hidden` and matches a `conditionalHidden` rule
- **THEN** the `hidden` check fires first and the tool is hidden without evaluating `conditionalHidden`

#### Scenario: ConditionalHidden checked before label lookup
- **WHEN** a tool matches a `conditionalHidden` rule
- **THEN** no label interpolation occurs (null is returned immediately)

### Requirement: Invalid Rule Handling
The system SHALL gracefully handle malformed `conditionalHidden` rules.

#### Scenario: Invalid regex pattern
- **WHEN** a `conditionalHidden` rule contains an invalid regex in `pattern`
- **THEN** the rule SHALL be skipped with a warning log
- **AND** remaining rules SHALL still be processed

### Requirement: Default SDK Tool-Result Read Rule
The shipped `_builtins.json` SHALL include a default `conditionalHidden` rule that hides `Read` calls targeting `tool-results/` paths.

#### Scenario: SDK tool-result read hidden by default
- **WHEN** Claude calls `Read` with a `file_path` starting with `tool-results/`
- **THEN** the task card for that `Read` call SHALL NOT appear in the Slack stream
