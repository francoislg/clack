## ADDED Requirements

### Requirement: Session Transcript Query Tool

The system SHALL provide a `find_session_transcript` query tool that returns the paginated full conversation transcript for a given `sessionId`, including per-turn payload, tool calls, outcome flags, and errors.

#### Scenario: Returns paginated messages for a session

- **WHEN** Claude calls `find_session_transcript` with a `sessionId` and optional `offset` and `limit`
- **THEN** the system loads the session's persisted `messages` array
- **AND** returns `messages.slice(offset, offset + limit)` with full shape preserved
- **AND** each `UserMessage` includes `role`, `source`, `text`, `ts`, optionally `value` (for choice) and `imageFiles` (for initial)
- **AND** each `AssistantMessage` includes `role`, `ts`, optionally `payload`, `toolCalls`, `error`, `skipped`, `disengaged`, `postedTopLevel`

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

#### Scenario: Result includes session metadata

- **WHEN** `find_session_transcript` returns successfully
- **THEN** the result includes `sessionId`, `channelId`, `channelName`, `triggerType`, `userId`, `displayName`, `createdAt`, `lastActivity`, `totalMessages`, and the paginated `messages` array
- **AND** `totalMessages` is the length of the session's full `messages` array (unaffected by `offset` and `limit`), usable by callers for pagination bounds-checking

#### Scenario: Unknown session returns error

- **WHEN** `find_session_transcript` is called with a `sessionId` that does not exist on disk
- **THEN** the tool returns an error indicating the session was not found
- **AND** does not raise an exception

#### Scenario: Pre-migration sessions have coarse timestamps

- **WHEN** `find_session_transcript` is called on a session that existed before the unified-conversation-log migration ran
- **THEN** all user-message entries converted from legacy `refinements[]` share the session's `createdAt` timestamp (per-refinement timestamps were not recorded pre-migration)
- **AND** the single converted assistant entry uses the session's `lastActivity` timestamp
- **AND** callers SHALL NOT rely on precise per-turn ordering for messages whose timestamps equal `createdAt` or `lastActivity` on pre-migration sessions
