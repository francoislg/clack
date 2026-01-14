## MODIFIED Requirements

### Requirement: Session State Persistence
The system SHALL persist session state to the filesystem for Claude Code access.

#### Scenario: Context file structure
- **WHEN** a session is created or updated
- **THEN** the system writes `data/sessions/{session-id}/context.json`
- **AND** includes the original question, thread context, refinements, conversation history, and threadTs

#### Scenario: Claude Code working files
- **WHEN** Claude Code runs in a session
- **THEN** it may create additional files in `data/sessions/{session-id}/`
- **AND** these files persist across refinements within the session

## ADDED Requirements

### Requirement: Session Restoration
The system SHALL restore sessions from disk when needed after an app restart.

#### Scenario: Lazy session restoration
- **WHEN** a user clicks a button (Accept, Reject, Refine, Update) after an app restart
- **AND** the session is not in memory
- **THEN** the system loads the session from `data/sessions/{session-id}/context.json`
- **AND** restores the session info (channelId, threadTs, userId) to memory
- **AND** continues processing the action normally

#### Scenario: Session info reconstruction from sessionId
- **WHEN** a user clicks a button after an app restart
- **AND** the session cannot be found on disk (expired or deleted)
- **THEN** the system parses the sessionId to extract channelId, messageTs, and userId
- **AND** reconstructs minimal session info to enable button handling

### Requirement: Expired Session Recreation
The system SHALL recreate expired sessions from Slack context when possible.

#### Scenario: Accept with expired session
- **WHEN** a user clicks Accept on an expired session
- **THEN** the system extracts the answer from the ephemeral message blocks
- **AND** posts the answer publicly without requiring session data

#### Scenario: Refine or Update with expired session
- **WHEN** a user clicks Refine or Update on an expired session
- **THEN** the system fetches the original message from Slack using the parsed messageTs
- **AND** fetches the current thread context
- **AND** creates a new session with the fetched data
- **AND** continues with the Refine or Update flow normally
