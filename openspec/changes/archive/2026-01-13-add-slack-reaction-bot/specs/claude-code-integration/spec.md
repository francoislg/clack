## ADDED Requirements

### Requirement: Claude Code Subprocess Invocation
The system SHALL spawn a Claude Code CLI subprocess for each answer generation request.

#### Scenario: Spawn subprocess with prompt
- **WHEN** answer generation is requested
- **THEN** the system spawns `claude` CLI as a child process
- **AND** passes the question and context via command-line arguments or stdin
- **AND** captures the output for delivery to Slack

#### Scenario: CLI path configurable
- **WHEN** the system starts
- **THEN** it reads the Claude Code CLI path from configuration
- **AND** uses this path for all subprocess invocations

### Requirement: Filesystem Permission Enforcement
The system SHALL enforce read-only access to repositories and write access to session directories when invoking Claude Code.

#### Scenario: Read-only repository access
- **WHEN** Claude Code subprocess is spawned
- **THEN** the `--allow-read` flag includes `data/repositories/*`
- **AND** Claude Code can read files in cloned repositories
- **AND** Claude Code cannot write to repository directories

#### Scenario: Write access to session directory
- **WHEN** Claude Code subprocess is spawned for a session
- **THEN** the `--allow-write` flag includes `data/sessions/{session-id}/*`
- **AND** Claude Code can create and modify files in that session's directory
- **AND** Claude Code cannot write outside the session directory

### Requirement: Non-Technical Response Style
The system SHALL instruct Claude Code to provide answers in non-technical language suitable for non-developers.

#### Scenario: System prompt enforces style
- **WHEN** Claude Code subprocess is spawned
- **THEN** the system prompt instructs Claude to explain in plain language
- **AND** avoid jargon unless necessary
- **AND** provide context that helps non-technical users understand

#### Scenario: Technical details available on request
- **WHEN** a user's refinement requests technical details
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
