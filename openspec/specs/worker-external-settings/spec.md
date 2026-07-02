# worker-external-settings Specification

## Purpose

Let operators constrain worker-mode Claude with external guardrails — PreToolUse command hooks and other native Claude Code settings — supplied entirely from outside the codebase, without Clack shipping or referencing any specific hook tool.

## Requirements

### Requirement: Forward operator-provided worker settings file

Worker-mode Claude SHALL forward an operator-provided native Claude Code settings file to the Agent SDK `settings` query option when the file is present at the configured fixed path, and SHALL run unchanged when it is absent.

#### Scenario: Settings file present

- **WHEN** worker-mode `runClaude` starts and the worker settings file exists at the configured path
- **THEN** the SDK `settings` query option is populated with the file's absolute path (or parsed contents)
- **AND** the worker subprocess loads the file's hooks and permission rules

#### Scenario: Settings file absent

- **WHEN** worker-mode `runClaude` starts and no worker settings file exists at the configured path
- **THEN** the SDK `settings` query option is omitted
- **AND** worker behavior is identical to before this change (isolation mode)

### Requirement: Absolute path resolution

The worker settings file path passed to the SDK SHALL be an absolute path, resolved from Clack's data directory rather than the worker's working directory.

#### Scenario: Path resolved independent of worktree cwd

- **WHEN** the worker settings file is forwarded and the worker `cwd` is a per-run worktree directory
- **THEN** the forwarded path resolves to the settings file under Clack's data directory
- **AND** it does not resolve relative to the worktree cwd

### Requirement: Coexistence with the built-in bash guard

Operator-supplied command hooks in the settings file SHALL coexist with the built-in programmatic `buildWorkerBashGuardHook` PreToolUse guard; neither shadows the other.

#### Scenario: Both hook channels active

- **WHEN** the settings file registers a PreToolUse command hook and a worker Bash tool call is made
- **THEN** the built-in bash guard still evaluates the call (e.g. blocking raw `git push`)
- **AND** the operator's command hook also evaluates the call

### Requirement: No tool-specific references in code

The codebase SHALL NOT reference any specific external hook tool by name; it SHALL only read and forward a generic native settings file whose contents and referenced binaries are provided entirely by the operator.

#### Scenario: Generic forwarding only

- **WHEN** the worker settings feature is exercised
- **THEN** the only Clack responsibility is locating and forwarding the settings file
- **AND** authoring the file's contents and installing any referenced hook binaries/scripts are out-of-band operator steps
