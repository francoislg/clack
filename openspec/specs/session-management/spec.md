# session-management Specification

## Purpose
TBD - created by archiving change add-slack-reaction-bot. Update Purpose after archive.
## Requirements
### Requirement: Session Creation
The system SHALL create a unique session for each triggered reaction.

#### Scenario: New session on trigger
- **WHEN** a user adds the trigger reaction to a message
- **THEN** the system creates a new session with a unique ID
- **AND** creates a directory at `data/sessions/{session-id}/`
- **AND** initializes session state in `context.json`

#### Scenario: Session ID format
- **WHEN** a session is created
- **THEN** the session ID includes the Slack channel, message timestamp, and user ID
- **AND** ensures uniqueness across concurrent requests

### Requirement: Session State Persistence
The system SHALL persist session state to the filesystem for Claude Code access.

#### Scenario: Context file structure
- **WHEN** a session is created or updated
- **THEN** the system writes `data/sessions/{session-id}/context.json`
- **AND** includes the original question, thread context, refinements, conversation history, and threadTs
- **AND** includes `username` and `displayName` for the requesting user when `fetchUserNames` is enabled

### Requirement: Session Timeout
The system SHALL expire sessions after a configurable period of inactivity.

#### Scenario: Session expires after timeout
- **WHEN** no user interaction occurs for the configured timeout period (default 15 minutes)
- **THEN** the system marks the session as expired
- **AND** the session directory may be cleaned up by the cleanup job

#### Scenario: Activity resets timeout
- **WHEN** user clicks Accept, Reject, Refine, or Update
- **THEN** the session's `lastActivity` timestamp is updated
- **AND** the timeout period resets

#### Scenario: Timeout configurable
- **WHEN** the system reads configuration
- **THEN** it uses `timeoutMinutes` for session expiration
- **AND** defaults to 15 minutes if not specified

### Requirement: Session Cleanup
The system SHALL periodically clean up expired sessions.

#### Scenario: Cleanup job runs on interval
- **WHEN** the configured cleanup interval has elapsed
- **THEN** the system scans `data/sessions/` for expired sessions
- **AND** removes session directories that have exceeded the timeout

#### Scenario: Cleanup interval configurable
- **WHEN** the system reads configuration
- **THEN** it uses `cleanupIntervalMinutes` for cleanup scheduling
- **AND** defaults to 5 minutes if not specified

### Requirement: Session Identification
The system SHALL identify sessions by the originating message and user.

#### Scenario: Same message, same user continues session
- **WHEN** a user interacts with buttons on an ephemeral response
- **THEN** the system looks up the existing session for that message and user
- **AND** continues the conversation in that session

#### Scenario: Different user creates new session
- **WHEN** a different user adds the trigger reaction to the same message
- **THEN** the system creates a separate session for that user
- **AND** each user has an independent conversation

### Requirement: Session Storage Directory
The system SHALL store all sessions under `data/sessions/`.

#### Scenario: Sessions directory creation
- **WHEN** the system starts
- **THEN** it creates `data/sessions/` if it does not exist
- **AND** ensures proper permissions for the directory

#### Scenario: Session directory contents
- **WHEN** a session is active
- **THEN** its directory contains at minimum `context.json`
- **AND** may contain additional files created by Claude Code

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

### Requirement: Thread Message Structure
The system SHALL store thread messages with optional user identity fields.

#### Scenario: Thread message with user names
- **WHEN** `fetchUserNames` is enabled
- **AND** thread context is captured
- **THEN** each `ThreadMessage` includes:
  - `text`: message content
  - `userId`: Slack user ID
  - `isBot`: boolean
  - `ts`: message timestamp
  - `username`: Slack handle (optional)
  - `displayName`: User's display name (optional)

#### Scenario: Thread message without user names
- **WHEN** `fetchUserNames` is disabled
- **THEN** `ThreadMessage` does not include `username` or `displayName` fields
- **AND** existing behavior is preserved

