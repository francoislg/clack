# instruction-variables Specification

## Purpose
Centralized registry of instruction template variables with metadata (name, description, availability) for documentation auto-generation and UI display.

## Requirements
### Requirement: Variable Definition Registry
The system SHALL maintain a centralized registry of all instruction template variables in `src/instructionVariables.ts`.

Each variable definition SHALL include:
- `name`: The variable key (e.g. `BOT_NAME`)
- `description`: Human-readable description of what the variable contains

#### Scenario: Registry contains all defined variables
- **WHEN** the registry is loaded
- **THEN** it contains a definition for every variable that `buildSystemPrompt()` produces
- **AND** each definition has a non-empty `name` and `description`

#### Scenario: Registry is exported for external use
- **WHEN** another module imports from `instructionVariables.ts`
- **THEN** it can access the full list of variable definitions
- **AND** it can access the `VariableDefinition` type

### Requirement: Variable Key Validation
The system SHALL validate that the variables record in `buildSystemPrompt()` matches the registry definitions.

#### Scenario: All registry variables have values
- **WHEN** `buildSystemPrompt()` builds the variables record
- **THEN** every variable defined in the registry has a corresponding key in the record

#### Scenario: Missing variable detected
- **WHEN** a registry-defined variable is missing from the variables record
- **THEN** the system logs a warning identifying the missing variable
