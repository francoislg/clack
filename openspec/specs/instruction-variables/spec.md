# instruction-variables Specification

## Purpose
Centralized registry of instruction template variables with metadata (name, description, availability) for documentation auto-generation and UI display.

## Requirements
### Requirement: Variable Definition Registry
The system SHALL maintain a centralized registry of all instruction template variables in `src/instructionVariables.ts`.

Each variable definition SHALL include:
- `name`: The variable key (e.g. `REPOSITORIES_LIST`)
- `description`: Human-readable description of what the variable contains
- `availability`: Either `"always"` (available in all instruction files) or `"dev-admin"` (only meaningful in dev/admin instruction files)

#### Scenario: Registry contains all defined variables
- **WHEN** the registry is loaded
- **THEN** it contains a definition for every variable that `buildSystemPrompt()` produces
- **AND** each definition has a non-empty `name`, `description`, and `availability`

#### Scenario: Registry is exported for external use
- **WHEN** another module imports from `instructionVariables.ts`
- **THEN** it can access the full list of variable definitions
- **AND** it can access the `VariableDefinition` type

### Requirement: Available Variables Meta-Variable
The system SHALL generate an `{AVAILABLE_VARIABLES}` meta-variable from the registry that renders a markdown reference table.

#### Scenario: Meta-variable renders variable table
- **WHEN** the `AVAILABLE_VARIABLES` variable is built
- **THEN** it produces a markdown table with columns: Variable, Description, Available
- **AND** each row corresponds to a registry entry (excluding `AVAILABLE_VARIABLES` itself)

#### Scenario: Meta-variable used in admin instructions
- **WHEN** admin instructions contain `{AVAILABLE_VARIABLES}`
- **THEN** the placeholder is replaced with the auto-generated variable reference table
- **AND** the table reflects the current registry contents

### Requirement: Variable Key Validation
The system SHALL validate that the variables record in `buildSystemPrompt()` matches the registry definitions.

#### Scenario: All registry variables have values
- **WHEN** `buildSystemPrompt()` builds the variables record
- **THEN** every variable defined in the registry has a corresponding key in the record

#### Scenario: Missing variable detected
- **WHEN** a registry-defined variable is missing from the variables record
- **THEN** the system logs a warning identifying the missing variable
