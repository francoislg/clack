## ADDED Requirements

### Requirement: Session Trace Retrieval Tool

The system SHALL provide an MCP tool `get_session_trace` that retrieves the full SDK conversation trace for any Clack session, enabling cross-session debugging.

#### Scenario: Retrieve trace by session ID

- **WHEN** an admin calls `get_session_trace` with a Clack `sessionId`
- **THEN** the tool looks up the `sdkSessionId` from the Clack session context
- **AND** reads the SDK session JSONL file from `~/.claude/projects/{cwd-slug}/{sdkSessionId}.jsonl`
- **AND** returns a structured summary of the conversation

#### Scenario: Default detail level

- **WHEN** `get_session_trace` is called without a `verbose` flag
- **THEN** the tool returns an overview: message types, tool names, timestamps
- **AND** the output fits within a single response

#### Scenario: Verbose detail level

- **WHEN** `get_session_trace` is called with `verbose: true`
- **THEN** the tool returns tool call args and truncated results in addition to the overview
- **AND** large tool results (file contents, grep output) are truncated to a reasonable length

#### Scenario: Session without SDK session ID

- **WHEN** `get_session_trace` is called for a session that has no `sdkSessionId`
- **THEN** the tool returns an error indicating no SDK session is available for this session

#### Scenario: SDK session file missing

- **WHEN** the SDK session JSONL file no longer exists on disk
- **THEN** the tool returns an error indicating the session trace has been cleaned up

#### Scenario: Retrieve trace for change execution session

- **WHEN** an admin calls `get_session_trace` with a Clack `sessionId`
- **AND** the session has an active or completed change with its own SDK session ID
- **THEN** the tool surfaces both the Q&A SDK session ID and the change execution SDK session ID
- **AND** returns traces for whichever is requested (defaulting to Q&A, with an optional `source: "change"` parameter)

### Requirement: Session Trace Tool Access Control

The system SHALL restrict `get_session_trace` to admin-role users.

#### Scenario: Admin access granted

- **WHEN** an admin-role user's query includes `get_session_trace` in the available tools
- **THEN** the tool is available and callable

#### Scenario: Non-admin access denied

- **WHEN** a user with role below admin triggers a query
- **THEN** `get_session_trace` is NOT included in the available MCP tools
