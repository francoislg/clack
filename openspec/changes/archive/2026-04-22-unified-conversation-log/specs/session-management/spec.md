## ADDED Requirements

### Requirement: Unified Conversation Log

The system SHALL persist the full conversation as a single temporal `messages: ConversationMessage[]` array on `SessionContext`, replacing the former `originalQuestion`, `refinements`, `lastAnswer`, `lastResponse`, and `continuationHistory` fields.

#### Scenario: Message array shape

- **WHEN** a session is persisted
- **THEN** `context.json` contains a `messages` array
- **AND** each entry is one of:
  - a `UserMessage` with `role: "user"`, `source`, `text`, `ts`, and — only when `source: "choice"` — a `value`, and — only when `source: "initial"` — optional `imageFiles`
  - an `AssistantMessage` with `role: "assistant"`, `ts`, and optional `payload`, `skipped`, `disengaged`, `postedTopLevel`, `toolCalls`, `error`
- **AND** entries appear in chronological order by `ts`
- **AND** legacy fields `originalQuestion`, `refinements`, `lastAnswer`, `lastResponse`, `continuationHistory`, and the session-level `toolCallHistory` are NOT written to new or migrated sessions

#### Scenario: Initial user message

- **WHEN** a session is created
- **THEN** `messages[0]` is a `UserMessage` with `source: "initial"`, `text` set to the user's original question, `ts` equal to `createdAt`, and `imageFiles` populated if the triggering message had attachments

#### Scenario: User refinement appended

- **WHEN** a user follow-up message is received in the thread
- **THEN** a `UserMessage` with `source: "refinement"` is appended to `messages` with the message text and current timestamp

#### Scenario: Choice button press appended as structured user message

- **WHEN** a user presses a choice action button
- **THEN** a `UserMessage` with `source: "choice"` is appended with `text` set to the choice label, `value` set to the machine value, and the current timestamp
- **AND** choice presses are NOT stored as `source: "refinement"` strings with the `"The user chose: "` prefix

#### Scenario: Followup button press appended as structured user message

- **WHEN** a user presses a followup action button
- **THEN** a `UserMessage` with `source: "followup"` is appended with `text` set to the followup prompt and the current timestamp

#### Scenario: Assistant turn appended after submit_response

- **WHEN** a query turn completes with a successful `submit_response` call
- **THEN** an `AssistantMessage` is appended to `messages` with `payload` set to the `SubmitResponsePayload`, `ts` set to the completion timestamp, and `toolCalls` set to the tool call records for this turn
- **AND** previous assistant messages in `messages` are NOT overwritten or removed

#### Scenario: Skipped assistant turn appended without payload

- **WHEN** a query turn completes via `submit_response` with `skip_response: true`
- **THEN** an `AssistantMessage` is appended with `skipped: true`, no `payload`, and `toolCalls` populated
- **AND** if `disengage: true` was also set, `disengaged: true` is included

#### Scenario: Top-level post recorded on assistant turn

- **WHEN** an assistant turn is posted at the top of the channel via `post_top_level: true`
- **THEN** the appended `AssistantMessage` includes `postedTopLevel: true`

#### Scenario: Errored turn appended as assistant message with error

- **WHEN** a query turn fails with an error attributable to the turn (not a session-level failure)
- **THEN** an `AssistantMessage` with `error` populated is appended
- **AND** the session-level `errors[]` is not written for this turn

### Requirement: Blocking Migration to Unified Conversation Log

The system SHALL run a blocking migration at startup that rewrites every persisted `context.json` under `data/sessions/` from the legacy shape (`originalQuestion`, `refinements`, `lastAnswer`, `lastResponse`) to the new `messages[]` shape, before any handler serves a request.

#### Scenario: Legacy session converted on startup

- **WHEN** the migration runs and encounters a `context.json` containing `originalQuestion`
- **THEN** the migration constructs `messages[0]` as `{ role: "user", source: "initial", text: originalQuestion, ts: createdAt, imageFiles }`
- **AND** appends each legacy `refinement` string in order as `{ role: "user", source: "refinement", text: refinement, ts: createdAt }`
- **AND** if `lastAnswer` or `lastResponse` is present, appends one `AssistantMessage` with `payload: lastResponse`, `toolCalls: toolCallHistory`, `ts: lastActivity`
- **AND** removes the legacy fields `originalQuestion`, `refinements`, `lastAnswer`, `lastResponse`, `continuationHistory`, and `toolCallHistory` from the persisted shape
- **AND** writes the new `context.json` atomically (write to a temp file then rename)

#### Scenario: Pre-migration choice refinements retain prefix

- **WHEN** the migration encounters a legacy refinement starting with `"The user chose: "`
- **THEN** the refinement is converted to `source: "refinement"` with the string preserved verbatim
- **AND** the migration does NOT attempt to parse the prefix back into `source: "choice"`

#### Scenario: Migration is idempotent

- **WHEN** the migration encounters a `context.json` that already contains a `messages` field
- **THEN** the migration skips the file and does not rewrite it

#### Scenario: Migration runs before handlers start

- **WHEN** the application starts
- **THEN** the migration completes (or records per-file failures) before any Slack handler is registered
- **AND** handlers therefore only ever read new-shape sessions

#### Scenario: Migration failure is recorded per file

- **WHEN** the migration fails for a specific `context.json` (parse error, disk error)
- **THEN** the failure is logged with the session ID
- **AND** the original file is left intact
- **AND** the migration continues processing remaining files
- **AND** the next boot re-attempts only sessions still in legacy shape

## REMOVED Requirements

### Requirement: Session State Persistence

**Reason**: Replaced by the `Unified Conversation Log` and `Blocking Migration to Unified Conversation Log` requirements. The legacy fields (`refinements`, `lastAnswer`, `lastResponse`, `continuationHistory`, session-level `toolCallHistory`) no longer exist — the conversation is now a single `messages[]` array, and tool calls are attached per-turn to `AssistantMessage`.

**Migration**: On first boot after this change, the blocking migration converts every persisted `context.json` in-place from the legacy shape to the new shape. Consumers MUST read via the selector module (`firstUserMessage`, `latestAssistantText`, `latestAssistantPayload`, `userContinuations`, `conversationLog`) rather than direct field access. The `originalQuestion`-reuse scenario on aborted sessions now updates `messages[0].text` instead.
