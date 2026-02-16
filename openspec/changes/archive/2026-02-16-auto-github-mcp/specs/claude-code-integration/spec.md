## MODIFIED Requirements

### Requirement: Claude Code Subprocess Invocation
The system SHALL use the Claude Agent SDK for answer generation requests.

#### Scenario: Query via Agent SDK
- **WHEN** answer generation is requested
- **THEN** the system calls the Agent SDK `query()` function
- **AND** passes the question and context as the prompt
- **AND** configures `cwd` to point to the repositories directory
- **AND** loads MCP servers asynchronously (awaiting token generation if needed)
- **AND** captures the response for delivery to Slack

#### Scenario: Model configurable
- **WHEN** the system starts
- **THEN** it reads the model name from configuration
- **AND** passes it to the SDK for all queries
