# claude-code-integration Specification

## Purpose
TBD - created by archiving change add-slack-reaction-bot. Update Purpose after archive.
## Requirements
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

### Requirement: Non-Technical Response Style
The system SHALL instruct Claude Code to provide answers in broad, non-technical language suitable for non-developers by default.

#### Scenario: System prompt enforces non-technical style
- **WHEN** Claude Code subprocess is spawned
- **THEN** the system prompt instructs Claude to explain like talking to a teammate who doesn't code
- **AND** never include file paths, line numbers, function names, table/field names, or code snippets
- **AND** focus on WHAT is happening and WHY, not HOW it's implemented

#### Scenario: Technical details available only on explicit request
- **WHEN** a user explicitly asks for "more details", "technical info", or "specifics"
- **THEN** Claude Code may include code references and technical explanations
- **AND** still prioritizes clarity over exhaustive technical accuracy

### Requirement: Multi-Repository Awareness
The system SHALL inform Claude Code about all configured repositories and their purposes.

#### Scenario: Repository list in system prompt
- **WHEN** Claude Code subprocess is spawned
- **THEN** the system prompt includes the list of available repositories
- **AND** each repository's name and description from config
- **AND** instructs Claude to determine which repo(s) are relevant to the question

#### Scenario: Claude selects relevant repository
- **WHEN** Claude Code processes a question
- **THEN** it determines which repository or repositories to search
- **AND** focuses its code exploration on the selected repo(s)

### Requirement: Session Context Continuation
The system SHALL pass previous conversation context to Claude Code for follow-up questions.

#### Scenario: Refinement includes previous context
- **WHEN** a user submits a Refine action with additional instructions
- **THEN** the system passes the original question, previous answer, and new instructions to Claude Code
- **AND** Claude Code generates a response that builds on the previous context

#### Scenario: Update preserves conversation history
- **WHEN** a user clicks Update to regenerate
- **THEN** the system passes the updated message/thread context along with any previous refinements
- **AND** Claude Code considers the full conversation history

### Requirement: Output Capture and Formatting
The system SHALL capture Claude Code output and format it appropriately for Slack.

#### Scenario: Markdown to Slack formatting
- **WHEN** Claude Code produces markdown output
- **THEN** the system converts it to Slack-compatible mrkdwn format
- **AND** preserves code blocks, lists, and emphasis

#### Scenario: Long responses truncated with notice
- **WHEN** Claude Code output exceeds Slack's message size limit
- **THEN** the system truncates the response
- **AND** appends a notice that the full response was truncated

