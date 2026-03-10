# error-reporting Specification

## Purpose
TBD - created by archiving change add-error-reporting. Update Purpose after archive.
## Requirements
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

The system SHALL show a friendly error message with retry option when errors occur. Error responses are now delivered via the stream or as a fallback `chat.postMessage`, not via ephemeral messages.

#### Scenario: Error delivered via stream
- **WHEN** Claude query fails and the stream is healthy
- **THEN** the system stops the stream with the error text and a "Try Again" button via `stopStream`

#### Scenario: Error delivered via fallback
- **WHEN** Claude query fails and the stream has failed
- **THEN** the system calls `streamer.stop()` to clear loading state
- **AND** posts error blocks with "Try Again" button via `chat.postMessage`
- **AND** targets the DM thread if in DM mode, otherwise the channel thread

### Requirement: DM Error Reporting

The system SHALL optionally send detailed error reports to users via direct message.

#### Scenario: Config flag controls DM reporting
- **WHEN** `slack.sendErrorsAsDM` is `true` in config
- **THEN** the system sends detailed error reports via DM to the requesting user
- **WHEN** `slack.sendErrorsAsDM` is `false` or not set
- **THEN** the system does not send error DMs

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

#### Scenario: DM failure handling
- **WHEN** sending the error DM fails
- **THEN** the system logs the failure
- **AND** continues normal error handling (does not block the response)

### Requirement: Migration Error DM Reporting

The system SHALL send migration error details to the admin via DM when a migration fails.

#### Scenario: DM admin on migration failure
- **WHEN** a migration fails during execution
- **AND** the admin has an open DM channel with the bot
- **THEN** send a DM to the admin with the migration name, error details, and guidance for resolution

#### Scenario: DM failure during migration error reporting
- **WHEN** sending the migration error DM fails
- **THEN** log the failure
- **AND** rely on the home tab banner as the fallback notification mechanism

### Requirement: Block Posting Retry on Invalid Blocks

The system SHALL rely on `submit_response`'s native delivery feedback loop for block error recovery, instead of external re-invoke retries.

#### Scenario: Slack rejects blocks during submit_response

- **WHEN** Claude calls `submit_response` with valid local blocks
- **AND** the Slack API rejects the delivery (invalid_blocks, msg_too_long)
- **THEN** `submit_response` returns the error details to Claude
- **AND** Claude can adjust the content and call `submit_response` again within the same conversation turn

#### Scenario: Claude self-corrects

- **WHEN** Claude receives a delivery error from `submit_response`
- **THEN** Claude shortens or restructures the response
- **AND** calls `submit_response` again with corrected content
- **AND** the corrected delivery succeeds

#### Scenario: Fallback on stream failure

- **WHEN** the streaming channel has failed (stream expired, API unreachable)
- **AND** Claude calls `submit_response`
- **THEN** the deliver callback falls back to `chat.postMessage`
- **AND** if that also fails, the error is returned to Claude

