## MODIFIED Requirements

### Requirement: Claude Code Subprocess Invocation
The system SHALL use the Claude Agent SDK for answer generation requests.

#### Scenario: Query via Agent SDK
- **WHEN** answer generation is requested
- **THEN** the system calls the Agent SDK `query()` function
- **AND** passes the question and context as the prompt
- **AND** configures `cwd` to point to the repositories directory
- **AND** captures the response for delivery to Slack

#### Scenario: Model configurable
- **WHEN** the system starts
- **THEN** it reads the model name from configuration
- **AND** passes it to the SDK for all queries

### Requirement: Non-Technical Response Style
The system SHALL instruct Claude Code to provide answers in broad, non-technical language suitable for non-developers by default.

#### Scenario: System prompt loaded from instruction files
- **WHEN** Claude Code subprocess is spawned
- **THEN** the system prompt is composed from `instructions.md` (base) plus a role-specific overlay file
- **AND** the role file is selected based on the user's role and changesWorkflow configuration
- **AND** variable interpolation is applied to the composed prompt

#### Scenario: Technical details available only on explicit request
- **WHEN** a user explicitly asks for "more details", "technical info", or "specifics"
- **THEN** Claude Code may include code references and technical explanations
- **AND** still prioritizes clarity over exhaustive technical accuracy

## REMOVED Requirements

### Requirement: systemPromptFile Configuration
**Reason**: Replaced by convention-based instruction file lookup. The system now uses fixed filenames (`instructions.md`, `dev_instructions.md`, etc.) resolved through a two-tier chain (`configuration/` → `default_configuration/`).
**Migration**: Move custom instruction file to `data/configuration/instructions.md`. Remove `claudeCode.systemPromptFile` from `data/config.json`.
