## MODIFIED Requirements

### Requirement: Claude Code Subprocess Invocation

The system SHALL use the Claude Agent SDK for answer generation requests.

#### Scenario: Query via Agent SDK

- **WHEN** answer generation is requested
- **THEN** the system calls the Agent SDK `query()` function
- **AND** passes the question and context as the prompt
- **AND** configures `cwd` to point to the repositories directory
- **AND** loads external MCP servers asynchronously (awaiting token generation if needed)
- **AND** builds the in-process `clack` MCP server with query context
- **AND** passes both external and clack MCP servers in `mcpServers`
- **AND** captures the `submit_response` tool call output as the structured response

#### Scenario: Model configurable

- **WHEN** the system starts
- **THEN** it reads the model name from configuration
- **AND** passes it to the SDK for all queries

### Requirement: Output Capture and Formatting

The system SHALL capture Claude's `submit_response` tool output and format it for Slack.

#### Scenario: Structured response from submit_response

- **WHEN** Claude calls `submit_response` during a query
- **THEN** the system captures the structured payload (sections and actions)
- **AND** uses the payload to render Slack blocks via the response renderer

#### Scenario: Fallback to raw text

- **WHEN** a query completes without Claude calling `submit_response`
- **THEN** the system falls back to the last assistant text output
- **AND** renders it as a plain section block with generic retry/reject actions

#### Scenario: Markdown to Slack formatting

- **WHEN** response sections contain markdown
- **THEN** the system converts markdown to Slack-compatible mrkdwn format
- **AND** preserves code blocks, lists, and emphasis

#### Scenario: Long responses split for Slack

- **WHEN** a section body exceeds Slack's 3000-character section block limit
- **THEN** the system splits the text at paragraph boundaries
- **AND** creates multiple section blocks

## REMOVED Requirements

### Requirement: Structured Response Parsing

**Reason**: Replaced by in-process MCP tools. Claude now calls typed tools (`propose_change`, `propose_config_update`, `submit_response`) instead of embedding XML tags in text output. The priority-based parsing chain (`parseChangeRequest` → `parseResumeRequest` → `parseConfigUpdate` → extract `<answer>` tags) is no longer needed.

**Migration**: Remove `parseChangeRequest()`, `parseResumeRequest()`, `parseConfigUpdate()`, and `<answer>` tag extraction from `askClaude()`. The `askClaude()` return type changes from a discriminated union (`isChangeRequest`, `isResumeRequest`, `isConfigUpdate`) to a structured `submit_response` payload. Callers that check `response.isChangeRequest` etc. should instead inspect the actions array from `submit_response`.
