# error-reporting Specification

## Purpose
TBD - created by archiving change add-error-reporting. Update Purpose after archive.
## Requirements
### Requirement: Conversation Trace Capture

The system SHALL capture the full conversation trace during Claude query execution for debugging purposes.

#### Scenario: Capture all SDK messages
- **WHEN** `askClaude()` executes a query
- **THEN** the system collects all SDK messages (system, assistant, result, tool_progress)
- **AND** includes message type, content summary, and timestamp
- **AND** stores the trace internally (not returned to caller)

#### Scenario: Trace captured on error
- **WHEN** Claude query fails with an error
- **THEN** the system captures the full conversation trace up to the point of failure
- **AND** stores it in the session's error history

### Requirement: Session Error Storage

The system SHALL persist all error traces in session context for debugging.

#### Scenario: Store error in session
- **WHEN** a Claude query fails
- **THEN** the system appends an error record to `session.errors` array
- **AND** the error record includes: timestamp, error message, and conversation trace
- **AND** previous errors in the session are preserved

#### Scenario: Multiple errors stored
- **WHEN** multiple errors occur in the same session
- **THEN** all error records are stored in `session.errors` array
- **AND** errors are ordered chronologically

### Requirement: Error Session Preservation

The system SHALL preserve sessions that contain errors for debugging.

#### Scenario: Skip cleanup of error sessions
- **WHEN** session cleanup runs
- **AND** a session has one or more entries in `session.errors`
- **THEN** the session is NOT deleted regardless of timeout
- **AND** the session remains available for debugging

#### Scenario: Normal sessions still cleaned up
- **WHEN** session cleanup runs
- **AND** a session has no errors
- **THEN** normal timeout-based cleanup applies

### Requirement: User-Friendly Error Display

The system SHALL show a friendly error message with retry option when errors occur.

#### Scenario: Generic error message
- **WHEN** Claude query fails
- **THEN** the system displays "Claude seems to have crashed, maybe try again?"
- **AND** does NOT expose technical error details to the user

#### Scenario: Retry button included
- **WHEN** an error message is displayed
- **THEN** it includes a "Try Again" button
- **AND** clicking the button re-triggers the query

### Requirement: DM Error Reporting

The system SHALL optionally send detailed error reports to users via direct message.

#### Scenario: Config flag controls DM reporting
- **WHEN** `slack.sendErrorsAsDM` is `true` in config
- **THEN** the system sends detailed error reports via DM to the requesting user
- **WHEN** `slack.sendErrorsAsDM` is `false` or not set
- **THEN** the system does not send error DMs

#### Scenario: Error report content
- **WHEN** an error DM is sent
- **THEN** it includes a header indicating an error occurred
- **AND** includes the session ID for reference
- **AND** includes a summarized conversation trace (last 5-10 messages)
- **AND** includes a Claude-generated error analysis

#### Scenario: Claude analyzes error
- **WHEN** an error DM is being prepared
- **THEN** the system sends the conversation trace to Claude for analysis
- **AND** requests a brief (2-3 sentence) explanation of what went wrong
- **AND** includes the analysis in the DM

#### Scenario: DM failure handling
- **WHEN** sending the error DM fails
- **THEN** the system logs the failure
- **AND** continues normal error handling (does not block the response)

