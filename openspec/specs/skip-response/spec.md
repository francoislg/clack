# skip-response Specification

## Purpose
Allow Claude to gracefully decline responding in auto-respond and thread-reply contexts via a `skip_response` flag on `submit_response`, with safeguard validation, message cleanup, and trigger gating.
## Requirements
### Requirement: Skip Response Safeguard Validation

The `submit_response` tool SHALL validate a skip request by requiring an exact acknowledgment message, rejecting with an instructive error if the message doesn't match. When `disengage` is also set, the tool SHALL additionally signal the session to deactivate tracking.

#### Scenario: Skip with correct acknowledgment

- **WHEN** Claude calls `submit_response` with `skip_response: true` and `message` equal to `"I acknowledge that responding to this would serve no purpose, so I am skipping it."`
- **THEN** the tool accepts the skip
- **AND** does NOT call the deliver callback
- **AND** does NOT render blocks or validate sections
- **AND** sets the skipped flag on ResponseCapture
- **AND** returns `{ success: true, skipped: true }` to Claude

#### Scenario: Skip with disengage

- **WHEN** Claude calls `submit_response` with `skip_response: true`, `disengage: true`, and the correct acknowledgment message
- **THEN** the tool accepts the skip
- **AND** sets the skipped flag on ResponseCapture
- **AND** sets the disengaged flag on ResponseCapture
- **AND** returns `{ success: true, skipped: true, disengaged: true }` to Claude

#### Scenario: Disengage without skip is rejected

- **WHEN** Claude calls `submit_response` with `disengage: true` but `skip_response` is not `true`
- **THEN** the tool rejects with an error: `"disengage requires skip_response: true"`

#### Scenario: Skip with wrong or missing message

- **WHEN** Claude calls `submit_response` with `skip_response: true` and `message` that does not exactly match the required string (or is omitted)
- **THEN** the tool rejects with an error containing the required exact message string
- **AND** Claude can retry with the correct message

#### Scenario: Skip flag ignored when false or absent

- **WHEN** Claude calls `submit_response` without `skip_response` or with `skip_response: false`
- **THEN** the tool behaves identically to its current behavior
- **AND** `sections` is required (min 1)

#### Scenario: Skip after successful delivery

- **WHEN** Claude calls `submit_response` with `skip_response: true` after a previous successful delivery in the same session
- **THEN** the tool returns an error indicating the response was already delivered
- **AND** the skip is NOT honored (cannot un-deliver a response)

### Requirement: Skip Response Message Deletion

When a skip is accepted, the system SHALL delete the streamer's message from Slack so that no visual trace of the response attempt remains.

#### Scenario: Streamer message deleted after skip

- **WHEN** `askClaude` returns with `response.skipped === true`
- **AND** a SlackStreamer was active with a known message `ts`
- **THEN** the system calls `chat.delete` with the streamer's channel and message `ts`
- **AND** the thinking indicator and all task cards are removed from Slack

#### Scenario: Skip with no streamer (defensive)

- **WHEN** `askClaude` returns with `response.skipped === true`
- **AND** no SlackStreamer was created (e.g., silentThinking mode or stream start failure)
- **THEN** the system skips the `chat.delete` step (no message to delete)
- **AND** session persistence and auto-execute are still skipped

#### Scenario: Delete failure is non-fatal

- **WHEN** `chat.delete` fails (e.g., message already deleted, permission error)
- **THEN** the system logs the error
- **AND** continues without re-throwing (the skip is still considered successful)
- **AND** the session is still NOT persisted (skip decision is independent of message deletion success)

### Requirement: Skip Response Session Handling

The system SHALL record skipped turns as `AssistantMessage` entries in the unified conversation log with `skipped: true`, skip auto-execute, and additionally deactivate tracking when disengaged.

#### Scenario: Skipped turn recorded in messages array

- **WHEN** a response is skipped (without disengage)
- **THEN** an `AssistantMessage` with `skipped: true` is appended to the session's `messages` array
- **AND** the appended message has no `payload`
- **AND** `toolCalls` is populated from the turn's tool call records

#### Scenario: Skipped turn with no tool calls

- **WHEN** a response is skipped
- **AND** the turn produced no tool call records
- **THEN** `toolCalls` is omitted from the appended `AssistantMessage` (not persisted as an empty array)

#### Scenario: Skipped-and-disengaged turn recorded

- **WHEN** a response is skipped with `disengage: true`
- **THEN** an `AssistantMessage` with `skipped: true` and `disengaged: true` is appended to the session's `messages` array
- **AND** `autoResponseActive` is set to `false` on the session
- **AND** both updates are persisted in the same `updateSession` call

#### Scenario: No auto-execute on skip

- **WHEN** a response is skipped
- **THEN** `handleAutoExecuteActions()` is NOT called

#### Scenario: Legacy fields not written

- **WHEN** a response is skipped
- **THEN** no `lastAnswer`, `lastResponse`, `stagedIntents`, or session-level `toolCallHistory` are written to the session
- **AND** (these legacy fields no longer exist on `SessionContext` — they have been removed by the Unified Conversation Log change)

### Requirement: Skip Response Trigger Gating

The `skip_response` and `disengage` parameters SHALL only be available in the `submit_response` schema when the session's trigger type allows skipping. The `scheduled` trigger SHALL additionally allow `skip_response` when the underlying cron job defines a non-empty `skipConditions` field.

#### Scenario: skip_response and disengage available for autoRespond

- **WHEN** the session's trigger type is `"autoRespond"`
- **THEN** the `submit_response` tool schema includes the `skip_response` boolean parameter
- **AND** the schema includes the `disengage` boolean parameter

#### Scenario: skip_response and disengage available for threadReply

- **WHEN** the session's trigger type is `"threadReply"`
- **THEN** the `submit_response` tool schema includes the `skip_response` boolean parameter
- **AND** the schema includes the `disengage` boolean parameter

#### Scenario: skip_response available for scheduled runs with skipConditions

- **WHEN** the session's trigger type is `"scheduled"`
- **AND** the originating cron job has a non-empty `skipConditions` string
- **THEN** the `submit_response` tool schema includes the `skip_response` boolean parameter
- **AND** the schema does NOT include the `disengage` boolean parameter (disengage is only meaningful for tracked-conversation triggers)

#### Scenario: Skip still enforces requiredTools gate

- **WHEN** a scheduled session has both `skipConditions` and non-empty `requiredTools`
- **AND** Claude calls `submit_response` with `skip_response: true` before calling every required tool
- **THEN** `submit_response` SHALL return the existing `requiredTools` gate error (missing tools listed) and NOT accept the skip
- **AND** Claude is expected to call the missing tool(s) and then retry with `skip_response: true`
- **AND** this matches today's behavior: the `requiredTools` gate runs before the skip branch, so a skip cannot bypass obligations the operator declared for the run

#### Scenario: skip_response not available for scheduled runs without skipConditions

- **WHEN** the session's trigger type is `"scheduled"`
- **AND** the originating cron job has no `skipConditions` (unset or empty string)
- **THEN** the `submit_response` tool schema does NOT include the `skip_response` parameter
- **AND** does NOT include the `disengage` parameter

#### Scenario: skip_response not available for explicit triggers

- **WHEN** the session's trigger type is `"reactions"`, `"directMessages"`, `"mentions"`, or any other explicit trigger
- **THEN** the `submit_response` tool schema does NOT include the `skip_response` parameter
- **AND** does NOT include the `disengage` parameter

### Requirement: Skip Response Prompt Guidance

The system SHALL include prompt guidance telling Claude when it can skip a response. For auto-respond and thread-reply triggers the guidance applies whenever the conversation does not warrant a reply. For scheduled triggers the guidance is rendered only when the job defines `skipConditions`, and it instructs Claude to evaluate those conditions before doing anything else.

#### Scenario: Auto-respond prompt includes skip guidance

- **WHEN** the delivery context prompt is built for a session with triggerType `"autoRespond"` or `"threadReply"`
- **THEN** the prompt includes guidance that Claude can use `skip_response` when users are talking to each other and not following up on what Clack said
- **AND** the prompt does NOT include the exact safeguard acknowledgment string

#### Scenario: Scheduled prompt includes skipConditions pre-check

- **WHEN** the delivery context prompt is built for a session with triggerType `"scheduled"`
- **AND** the originating cron job defines a non-empty `skipConditions` string
- **THEN** the prompt includes a pre-check section instructing Claude to evaluate the provided conditions before any other work
- **AND** the prompt includes the verbatim `skipConditions` text supplied by the operator
- **AND** the prompt tells Claude to call `submit_response` with `skip_response: true` when any condition applies
- **AND** the prompt does NOT include the exact safeguard acknowledgment string

#### Scenario: Scheduled prompt omits skip guidance when skipConditions is absent

- **WHEN** the delivery context prompt is built for a session with triggerType `"scheduled"`
- **AND** the originating cron job has no `skipConditions` (unset or empty)
- **THEN** the prompt does NOT include any skip-related guidance

