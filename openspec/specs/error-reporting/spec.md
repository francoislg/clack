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

### Requirement: Block Posting Retry on Invalid Blocks

The system SHALL retry Claude when the Slack API rejects blocks with `invalid_blocks` despite passing local validation.

#### Scenario: Handler catches invalid_blocks error

- **WHEN** the handler posts rendered blocks to Slack
- **AND** the Slack API returns an `invalid_blocks` error
- **THEN** the system injects the error details as a refinement into the session
- **AND** re-invokes `askClaude()` so Claude can fix and resubmit via `submit_response`

#### Scenario: Retry limit enforced

- **WHEN** the handler has already retried the maximum number of times (1 retry)
- **AND** the Slack API returns `invalid_blocks` again
- **THEN** the system does NOT retry further
- **AND** falls back to posting the plain text answer without blocks

#### Scenario: Retry applies to all posting paths

- **WHEN** an `invalid_blocks` error occurs
- **THEN** the retry behavior applies to the initial response flow (core.ts) and all button handler response flows (handlerResponse.ts)

### Requirement: Plain Text Fallback on Exhausted Retries

The system SHALL fall back to plain text when block posting fails after retries are exhausted.

#### Scenario: Fallback posts plain text

- **WHEN** block retries are exhausted
- **THEN** the system posts the response as plain text (no blocks) using the answer text
- **AND** the message is delivered to the user (not lost)

#### Scenario: Fallback preserves response style

- **WHEN** the fallback posts plain text
- **THEN** it respects the original response style (ephemeral for reactions, regular for DMs/mentions)

