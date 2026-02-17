## MODIFIED Requirements

### Requirement: Variable Interpolation

The system SHALL interpolate variables in all instruction files.

#### Scenario: Standard variables

- **WHEN** instruction files are loaded
- **THEN** the system replaces `{BOT_NAME}` with the configured app name

#### Scenario: Unavailable variables resolve to empty

- **GIVEN** a variable is referenced in an instruction file but has no value in context
- **WHEN** interpolation runs
- **THEN** the variable placeholder is replaced with an empty string
- **AND** a warning is logged identifying the unknown variable

### Requirement: Prompt Composition

The system SHALL compose the final system prompt by concatenating base and role files.

#### Scenario: Compose base plus role

- **WHEN** building the system prompt
- **THEN** the system concatenates: base instructions + role instructions
- **AND** interpolates variables after concatenation
- **AND** the role section is separated by a newline from the base

#### Scenario: Instruction files contain behavioral guidance only

- **WHEN** instruction files are authored or customized
- **THEN** they contain tone, style, and behavioral rules
- **AND** they do NOT contain XML format documentation or state dump placeholders
- **AND** dynamic state (repositories, sessions, config files) is available to Claude via query tools instead
