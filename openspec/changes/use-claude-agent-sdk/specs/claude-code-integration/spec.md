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

### Requirement: Filesystem Permission Enforcement
The system SHALL enforce read-only access to repositories by restricting allowed tools.

#### Scenario: Read-only repository access
- **WHEN** the Agent SDK query is invoked
- **THEN** the `allowedTools` option includes only `Read`, `Glob`, and `Grep`
- **AND** excludes `Write`, `Edit`, and `Bash`
- **AND** Claude can read files in cloned repositories
- **AND** Claude cannot modify any files
