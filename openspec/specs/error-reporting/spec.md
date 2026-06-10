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

### Requirement: Error-report load is schema-driven

`readErrorReport` SHALL validate a persisted error report against an `ErrorReport` zod schema rather than a blind `JSON.parse(content) as ErrorReport` cast, preserving its graceful contract: a missing file, invalid JSON, or shape mismatch SHALL return `null`, never throw. This loader has no test today; a loader test SHALL be added with the migration to gate the behavior.

#### Scenario: Corrupt report degrades to null

- **WHEN** an error-report file is absent, not valid JSON, or fails schema validation
- **THEN** `readErrorReport` returns `null`

#### Scenario: A valid report round-trips

- **WHEN** a well-formed error report is read
- **THEN** the parsed `ErrorReport` matches the pre-migration result

## ADDED Requirements

### Requirement: Localized User-Facing Error Messages

All user-visible error messages emitted by Clack's own TypeScript code (not produced by Claude) — including in-stream error text, fallback `chat.postMessage` error blocks, "Try Again" button labels, permission-denied messages, validation-rejection messages, and the headers of error-report DMs — SHALL be sourced from the localization dictionary via the `t()` helper.

Internal diagnostic content within error reports (stack traces, raw error messages from third-party APIs, tool-call dumps, session IDs) SHALL pass through unchanged. These are debugging aids, not user-facing prose.

Claude-generated error analysis text (the narrative produced when Claude is asked to summarize what went wrong for a DM error report) SHALL be written in the configured language because Claude operates under the language directive — no `t()` call is required on that path.

#### Scenario: Streamed error message localized

- **GIVEN** the configured language is `"fr"`
- **WHEN** a Claude query fails and the stream is healthy
- **THEN** the error text delivered via `stopStream` is rendered in French via `t()`
- **AND** the "Try Again" button label is rendered in French via `t()`

#### Scenario: Fallback chat.postMessage error blocks localized

- **GIVEN** the configured language is `"fr"`
- **WHEN** a Claude query fails and the stream has failed
- **THEN** the error blocks posted via `chat.postMessage` use French strings sourced via `t()`
- **AND** the "Try Again" button label is in French via `t()`

#### Scenario: Error-report DM header localized

- **GIVEN** the configured language is `"fr"` AND `slack.sendErrorsAsDM` is `true`
- **WHEN** an error DM is sent
- **THEN** the header text indicating an error occurred is in French via `t()`
- **AND** the session-ID label and any surrounding bot-authored prose are in French via `t()`
- **AND** the embedded stack trace, raw API error, and tool-call dump pass through unchanged

#### Scenario: Claude-authored error analysis follows language directive

- **GIVEN** the configured language is `"fr"`
- **WHEN** Claude is invoked to analyze an error for inclusion in a DM
- **THEN** the analysis narrative is produced in French (via the language directive)
- **AND** no `t()` lookup is required because the text is Claude-authored, not template-authored

#### Scenario: Migration-failure admin DM localized

- **GIVEN** the configured language is `"fr"`
- **WHEN** a migration fails and the admin DM is sent
- **THEN** the bot-authored framing of the message (intro, guidance line) is in French via `t()`
- **AND** the migration name, error message, and stack trace pass through unchanged

