# auto-respond-tracking Specification

## Purpose
TBD - created by archiving change auto-respond-tracking. Update Purpose after archive.
## Requirements
### Requirement: Auto-Respond Tracking State

The system SHALL maintain an explicit `autoResponseActive` boolean on each session to control whether thread messages are evaluated for auto-respond.

#### Scenario: Default to active on session creation

- **WHEN** a new session is created (any trigger type)
- **THEN** `autoResponseActive` is set to `true`
- **AND** the field is persisted in `context.json`

#### Scenario: Existing sessions without field default to active

- **WHEN** a session is loaded from disk and does not have an `autoResponseActive` field
- **THEN** the system treats the session as if `autoResponseActive` is `true`
- **AND** no migration is required

#### Scenario: Thread auto-respond skips inactive sessions

- **WHEN** a thread reply arrives
- **AND** a session exists for the thread with `autoResponseActive === false`
- **THEN** the system does NOT run pre-analysis
- **AND** does NOT invoke Claude
- **AND** returns immediately (no cost incurred)

#### Scenario: Tracking state persisted across restarts

- **WHEN** `autoResponseActive` is set to `false`
- **AND** the application restarts
- **THEN** the session loaded from disk retains `autoResponseActive: false`
- **AND** the thread remains disengaged

#### Scenario: Top-level auto-respond messages unaffected

- **WHEN** a top-level message matches an auto-respond rule
- **THEN** `autoResponseActive` on any existing session is NOT consulted
- **AND** a new session is created with `autoResponseActive` defaulting to `true`

### Requirement: Disengagement via Pre-Analysis

The system SHALL support disengagement from a thread when the pre-analysis classifier determines the conversation has moved on.

#### Scenario: Pre-analysis returns "stop"

- **WHEN** pre-analysis evaluates a thread message and returns `"stop"`
- **THEN** the system sets `autoResponseActive = false` on the session
- **AND** persists the updated session to disk
- **AND** does NOT invoke Claude for this message
- **AND** logs the disengagement at info level

### Requirement: Disengagement via submit_response

The system SHALL support disengagement from a thread when Claude decides the conversation no longer needs Clack.

#### Scenario: Claude uses skip_response with disengage

- **WHEN** Claude calls `submit_response` with `skip_response: true` and `disengage: true`
- **THEN** the skip is processed normally (streamer message deleted, no session persistence of response)
- **AND** `autoResponseActive` is set to `false` on the session
- **AND** the updated `autoResponseActive` value is persisted to disk

#### Scenario: Disengage on already-disengaged session is idempotent

- **WHEN** Claude calls `submit_response` with `skip_response: true` and `disengage: true`
- **AND** `autoResponseActive` is already `false` on the session
- **THEN** the tool succeeds (idempotent)
- **AND** `autoResponseActive` remains `false`

#### Scenario: disengage without skip_response is rejected

- **WHEN** Claude calls `submit_response` with `disengage: true` but `skip_response` is not `true`
- **THEN** the tool returns an error indicating `disengage` requires `skip_response: true`

#### Scenario: disengage flag only available when skip is available

- **WHEN** the session's trigger type is NOT `"autoRespond"` or `"threadReply"`
- **THEN** the `disengage` parameter is NOT included in the `submit_response` schema

### Requirement: Disengagement via stop_tracking Tool

The system SHALL provide a `stop_tracking` query tool for cross-thread disengagement.

#### Scenario: Stop tracking by Slack URL

- **WHEN** Claude calls `stop_tracking` with a valid Slack message URL
- **THEN** the tool parses the URL to extract channel ID and message timestamp
- **AND** looks up the session via `findSessionByThread(channelId, threadTs)`
- **AND** sets `autoResponseActive = false` on the found session
- **AND** persists the updated session to disk
- **AND** returns confirmation with the thread details

#### Scenario: No session found for URL

- **WHEN** Claude calls `stop_tracking` with a URL that has no associated session
- **THEN** the tool returns an error indicating no tracked session was found for that thread

#### Scenario: Permission check on stop_tracking

- **WHEN** a non-admin user calls `stop_tracking`
- **AND** the target session's `userId` does not match the requesting user
- **THEN** the tool returns an error indicating insufficient permissions

#### Scenario: Admin can stop any thread

- **WHEN** an admin or owner calls `stop_tracking`
- **THEN** the tool disengages the thread regardless of who created the session

#### Scenario: Tool registered when Slack client available

- **WHEN** the tool server is built in query mode
- **AND** a Slack client is available in the context
- **THEN** the `stop_tracking` tool is registered for all roles (runtime permission checks apply per scenarios below)

### Requirement: Re-Activation via @Mention

The system SHALL re-activate auto-respond tracking when Clack is explicitly @mentioned in a disengaged thread.

#### Scenario: Mention in disengaged thread re-activates tracking

- **WHEN** a user @mentions Clack in a thread
- **AND** a session exists for the thread with `autoResponseActive === false`
- **THEN** the mention handler sets `autoResponseActive = true` on the session
- **AND** persists the updated session to disk
- **AND** proceeds with normal mention processing

#### Scenario: Mention in thread with no session

- **WHEN** a user @mentions Clack in a thread with no existing session
- **THEN** normal mention processing creates a new session
- **AND** `autoResponseActive` defaults to `true` (standard creation behavior)

#### Scenario: Mention in already-active thread

- **WHEN** a user @mentions Clack in a thread with `autoResponseActive === true`
- **THEN** the mention handler proceeds normally
- **AND** `autoResponseActive` remains `true` (no-op)

### Requirement: Prompt Guidance for Disengagement

The system SHALL include prompt guidance telling Claude when to use the `disengage` flag.

#### Scenario: Auto-respond prompt includes disengage guidance

- **WHEN** the delivery context prompt is built for a session with triggerType `"autoRespond"` or `"threadReply"`
- **THEN** the prompt includes guidance that Claude can use `disengage: true` with `skip_response` when the thread conversation has clearly moved on from the original topic
- **AND** the prompt distinguishes between `skip_response` alone (temporary silence, stay engaged) and `skip_response` + `disengage` (permanent disengagement until re-mentioned)

