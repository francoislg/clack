## MODIFIED Requirements

### Requirement: Conversation Trace Capture

The system SHALL capture structured tool call data during Claude query execution for debugging purposes.

#### Scenario: Capture all SDK messages

- **WHEN** `askClaude()` executes a query
- **THEN** the system collects all SDK messages (system, assistant, result, tool_progress)
- **AND** includes message type, content summary, and timestamp
- **AND** stores the trace internally (not returned to caller)

#### Scenario: Capture clack tool calls with full detail

- **WHEN** Claude calls a clack tool during a query
- **THEN** the conversation trace includes a typed record: tool name, input arguments, result payload, and timestamp
- **AND** validation errors from action tools are captured (showing the retry loop)

#### Scenario: Trace captured on error

- **WHEN** Claude query fails with an error
- **THEN** the system captures the full conversation trace up to the point of failure
- **AND** the trace includes any tool calls made before the error
- **AND** stores it in the session's error history

### Requirement: Session Error Storage

The system SHALL persist all error traces in session context for debugging.

#### Scenario: Store error in session

- **WHEN** a Claude query fails
- **THEN** the system appends an error record to `session.errors` array
- **AND** the error record includes: timestamp, error message, conversation trace (with typed tool call records)
- **AND** previous errors in the session are preserved

#### Scenario: Multiple errors stored

- **WHEN** multiple errors occur in the same session
- **THEN** all error records are stored in `session.errors` array
- **AND** errors are ordered chronologically

### Requirement: DM Error Reporting

The system SHALL optionally send detailed error reports to users via direct message.

#### Scenario: Error report content with tool context

- **WHEN** an error DM is sent
- **THEN** it includes a header indicating an error occurred
- **AND** includes the session ID for reference
- **AND** includes a summarized conversation trace showing tool calls and their results
- **AND** includes a Claude-generated error analysis

#### Scenario: Claude analyzes error with tool context

- **WHEN** an error DM is being prepared
- **THEN** the system sends the conversation trace (including tool call records) to Claude for analysis
- **AND** requests a brief explanation of what went wrong
- **AND** tool validation errors in the trace provide richer context for analysis
