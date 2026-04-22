## MODIFIED Requirements

### Requirement: Unified Conversation Log

The system SHALL persist a session's conversation as a structured **`trigger`** metadata object plus a temporal **`messages: SessionMessage[]`** array on `SessionContext`. The trigger describes what created the session; `messages[]` is a pure log of turns that happened after, starting at index 0 with Clack's first assistant turn.

#### Scenario: Trigger shape is a discriminated union

- **WHEN** a session is persisted
- **THEN** `context.json` includes a `trigger` object whose `type` is one of `"reactions"`, `"mentions"`, `"directMessages"`, `"autoRespond"`, or `"scheduled"`
- **AND** for `"reactions"`, `trigger` includes `userId`, `emoji`, `messageTs`, `messageText`, and optional `imageFiles`
- **AND** for `"mentions"`, `"directMessages"`, `"autoRespond"`, `trigger` includes `userId`, `messageTs`, `messageText`, and optional `imageFiles`; `"autoRespond"` additionally carries optional `ruleName` and optional `preAnalysis`
- **AND** for `"scheduled"`, `trigger` includes `prompt`, optional `jobId`, and optional `preAnalysis`; no `userId` / `messageTs` / `messageText` fields
- **AND** `messageTs` on the trigger is the Slack timestamp of the triggering message (for user-first types)

#### Scenario: Messages array shape

- **WHEN** a session has had at least one assistant turn
- **THEN** `context.json` contains a `messages` array
- **AND** each entry is one of:
  - a `SessionUserMessage` with `role: "user"`, `source` of `"reply" | "choice" | "followup"`, `text`, `ts`, and — only when `source: "choice"` — a `value`
  - a `SessionAssistantMessage` with `role: "assistant"`, `ts`, and optional `text`, `payload`, `toolCalls`, `skipped`, `disengaged`, `postedTopLevel`, `error`, `preAnalysis`
- **AND** `messages[0]` is ALWAYS a `SessionAssistantMessage` (Clack's first delivered response)
- **AND** entries appear in chronological order by `ts`
- **AND** NO `SessionUserMessage` has `source: "initial"` or `source: "refinement"` (those sources are removed)

#### Scenario: Empty messages on new session

- **WHEN** a session is created but Claude has not yet delivered a response
- **THEN** `messages` is an empty array
- **AND** the `trigger` carries all metadata about the triggering event
- **AND** the session is a valid on-disk entity (e.g., a `find_session_transcript` call on it returns `totalMessages: 0`)

#### Scenario: User reply appended

- **WHEN** a user posts a thread reply on an existing session
- **THEN** a `SessionUserMessage` with `source: "reply"` is appended to `messages` with the message text and current timestamp
- **AND** the trigger is untouched

#### Scenario: Choice button press appended as structured user message

- **WHEN** a user presses a choice action button
- **THEN** a `SessionUserMessage` with `source: "choice"` is appended with `text` set to the choice label, `value` set to the machine value, and the current timestamp

#### Scenario: Followup button press appended as structured user message

- **WHEN** a user presses a followup action button
- **THEN** a `SessionUserMessage` with `source: "followup"` is appended with `text` set to the followup prompt and the current timestamp

#### Scenario: Assistant turn appended after submit_response

- **WHEN** a query turn completes with a successful `submit_response` call
- **THEN** a `SessionAssistantMessage` is appended to `messages` with `payload` set to the `SubmitResponsePayload`, `ts` set to the completion timestamp, and `toolCalls` set to the tool call records for this turn
- **AND** previous assistant messages in `messages` are NOT overwritten or removed

#### Scenario: Skipped assistant turn appended without payload

- **WHEN** a query turn completes via `submit_response` with `skip_response: true`
- **THEN** a `SessionAssistantMessage` is appended with `skipped: true`, no `payload`, and `toolCalls` populated
- **AND** if `disengage: true` was also set, `disengaged: true` is included

#### Scenario: Top-level post recorded on assistant turn

- **WHEN** an assistant turn is posted at the top of the channel via `post_top_level: true`
- **THEN** the appended `SessionAssistantMessage` includes `postedTopLevel: true`

#### Scenario: Errored turn appended as assistant message with error

- **WHEN** a query turn fails with an error attributable to the turn (not a session-level failure)
- **THEN** a `SessionAssistantMessage` with `error` populated is appended

#### Scenario: Pre-analysis verdict captured per autoRespond turn

- **WHEN** a query turn is driven by autoRespond (either the initial session-creating trigger or a threadReply continuation)
- **AND** the pre-analysis gate ran and produced a verdict
- **THEN** the verdict is stored as `preAnalysis` on the appended `SessionAssistantMessage`
- **AND** for session-creating autoRespond triggers the same verdict is also stored on `trigger.preAnalysis`

#### Scenario: Session reuse always appends — no abort-edit rewrite

- **WHEN** a handler fires on an existing session (found via `findSessionByThread`)
- **THEN** a `SessionUserMessage` with `source: "reply"` is appended with the new message text
- **AND** the trigger's `messageText` is NOT mutated
- **AND** `messages[0]` is NOT mutated

## REMOVED Requirements

### Requirement: Blocking Migration to Unified Conversation Log

**Reason**: Replaced by the lazy-synthesis approach in `getSession`. Session files in the legacy shape (pre-`unified-conversation-log`) AND the first-wave unified-log shape (`messages[0]` as a user `source: "initial"`) both load correctly via `synthesizeMessagesFromLegacy`, which now produces the trigger+messages split. No one-shot startup migration is needed; stale sessions age out via 30-day retention.

**Migration**: The synthesizer handles both legacy shapes on read. First write after load materializes the final shape.

### Requirement: Session State Persistence

**Reason**: Already removed by the `unified-conversation-log` change. No separate action needed.

**Migration**: See `Unified Conversation Log` requirement for the new shape.
