# session-transcript-tool Specification

## Purpose

Query tool that provides paginated full conversation transcripts for a given session, including per-turn payload, tool calls, outcomes, and errors, alongside the session's structured trigger metadata.

## Requirements

### Requirement: Session Transcript Query Tool

The system SHALL provide a `find_session_transcript` query tool that returns the paginated full conversation transcript for a given `sessionId`, including per-turn payload, tool calls, outcome flags, and errors. Results include the session's structured `trigger` alongside the `messages` array so callers see both the session-creating event and the subsequent conversation.

#### Scenario: Returns paginated messages for a session

- **WHEN** Claude calls `find_session_transcript` with a `sessionId` and optional `offset` and `limit`
- **THEN** the system loads the session's persisted `messages` array
- **AND** returns `messages.slice(offset, offset + limit)` with full shape preserved
- **AND** each `SessionUserMessage` includes `role`, `source` (`"reply" | "choice" | "followup"`), `text`, `ts`, and optionally `value` (for choice)
- **AND** each `SessionAssistantMessage` includes `role`, `ts`, and optionally `text`, `payload`, `toolCalls`, `error`, `skipped`, `disengaged`, `postedTopLevel`, `preAnalysis`

#### Scenario: Default and maximum pagination

- **WHEN** `find_session_transcript` is called without an explicit `limit`
- **THEN** the tool defaults to returning 20 messages
- **AND** rejects `limit` values greater than 100 with an error

#### Scenario: Invalid pagination parameters rejected

- **WHEN** `find_session_transcript` is called with a `limit` that is zero, negative, or non-integer
- **THEN** the tool rejects the call with a schema validation error
- **AND** the same rejection occurs for a `offset` that is negative or non-integer

#### Scenario: Offset beyond end returns empty

- **WHEN** `find_session_transcript` is called with `offset` greater than or equal to `messages.length`
- **THEN** the tool returns an empty `messages` array and a `totalMessages` count

#### Scenario: Privacy — owner always sees their own transcript

- **WHEN** the caller's user ID matches the session's `userId`
- **THEN** the transcript is returned regardless of channel privacy

#### Scenario: Privacy — non-owners require a known-public channel

- **WHEN** a different user than the session owner requests a transcript
- **AND** the session's channel is confirmed public via `conversations.info` (`is_private: false`)
- **THEN** the transcript is returned
- **AND** otherwise the tool returns an error `"session not visible"`

#### Scenario: Privacy — DMs are only visible to their owner

- **WHEN** the session's channel is a DM (starts with `D`) and the caller is not the session owner
- **THEN** the tool returns an error `"session not visible"`

#### Scenario: Privacy — private channels excluded for non-owners

- **WHEN** the session is in a legacy private group (starts with `G`) or a `C`-prefixed channel confirmed private
- **AND** the caller is not the session owner
- **THEN** the tool returns an error `"session not visible"`

#### Scenario: Privacy — channel privacy check failure treats channel as private

- **WHEN** resolving whether a candidate session's channel is public requires `conversations.info`
- **AND** the call fails (network error, rate limit, missing permission) or privacy cannot be determined
- **AND** the caller is not the session owner
- **THEN** the channel is treated as private
- **AND** the tool returns an error `"session not visible"`

#### Scenario: Result includes session metadata and trigger

- **WHEN** `find_session_transcript` returns successfully
- **THEN** the result includes `sessionId`, `channelId`, `channelName`, `triggerType`, `userId`, `displayName`, `createdAt`, `lastActivity`, `totalMessages`, the paginated `messages` array, AND the session's structured `trigger` object
- **AND** `totalMessages` is the length of the session's full `messages` array (unaffected by `offset` and `limit`), usable by callers for pagination bounds-checking
- **AND** the `trigger` carries its full discriminated-union shape so debuggers see the session-creating event verbatim

#### Scenario: Unknown session returns error

- **WHEN** `find_session_transcript` is called with a `sessionId` that does not exist on disk
- **THEN** the tool returns an error indicating the session was not found
- **AND** does not raise an exception

#### Scenario: Legacy-shape sessions synthesize correctly on read

- **WHEN** `find_session_transcript` is called on a session whose `context.json` predates the trigger/messages split (e.g., has `originalQuestion` OR has `messages[0]` as a user `source: "initial"`)
- **THEN** the tool's `resolveMessages` fallback synthesizes a trigger-plus-messages view matching the final shape
- **AND** the returned `trigger.messageText` (or `trigger.prompt` for scheduled sessions) reflects the pre-split originating text
- **AND** `messages[]` returned to the caller contains only assistant turns and post-trigger user replies
