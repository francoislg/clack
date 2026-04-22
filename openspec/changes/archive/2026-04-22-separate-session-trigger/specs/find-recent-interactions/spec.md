## MODIFIED Requirements

### Requirement: Find Recent Interactions Tool

The system SHALL provide a `find_recent_interactions` query tool that searches persisted Q&A session history so Claude can recover context from prior interactions. The tool returns a lightweight summary per session derived from the session's `trigger` metadata and `messages[]` log; full transcripts are retrieved separately via `find_session_transcript`.

#### Scenario: Returns sessions matching keywords

- **WHEN** Claude calls `find_recent_interactions` with a `keywords` parameter
- **THEN** the system returns only sessions where the keyword string appears (case-insensitive) in `trigger.messageText` (for user-first triggers) or `trigger.prompt` (for scheduled), any `SessionUserMessage.text`, any `SessionAssistantMessage.text`, any `SessionAssistantMessage.payload.message`, or the rendered text of any `SessionAssistantMessage.payload.blocks`
- **AND** keyword matching considers the trigger AND every message in the unified `messages` array

#### Scenario: Returns all recent sessions when no keywords given

- **WHEN** Claude calls `find_recent_interactions` without a `keywords` parameter
- **THEN** the system returns sessions sorted by `createdAt` descending, up to `limit`

#### Scenario: Filter by channel ID

- **WHEN** Claude calls `find_recent_interactions` with a `channel` parameter set to a Slack channel ID
- **THEN** only sessions whose `channelId` matches (or whose `originChannel` matches, for DM-first-delivered sessions) are returned
- **AND** standard privacy rules still apply to every candidate session

#### Scenario: Filter by trigger type

- **WHEN** Claude calls `find_recent_interactions` with a `trigger_type` parameter
- **THEN** only sessions with matching `trigger.type` are returned
- **AND** valid values are `"reactions"`, `"directMessages"`, `"mentions"`, `"autoRespond"`, or `"scheduled"`
- **AND** `"threadReply"` is NOT a valid trigger-type value (it's not a session-creating trigger — threadReply continuations inherit the creating trigger's type)

#### Scenario: Privacy — known-public channels visible to all

- **WHEN** any user calls `find_recent_interactions`
- **AND** a candidate session's channel has been confirmed public via Slack's `conversations.info` (`is_private: false`)
- **THEN** the session is included in results regardless of which user triggered it

#### Scenario: Privacy — channel-prefix alone does not imply public

- **WHEN** a candidate session has a `C`-prefixed channel ID (which in modern Slack may be either public or private)
- **THEN** the system SHALL consult `conversations.info` to determine the channel's actual privacy before including the session for non-owners
- **AND** if privacy cannot be resolved (no Slack client available, API error, unknown), the channel is treated as private and the session is only visible to its owner

#### Scenario: Privacy — DMs scoped to requesting user

- **WHEN** any user calls `find_recent_interactions`
- **THEN** DM sessions are only included if `userId` on the session matches the calling user's ID
- **AND** other users' DM sessions are never returned

#### Scenario: Privacy — private channels excluded

- **WHEN** any user calls `find_recent_interactions`
- **THEN** sessions from legacy private group channels (Slack channel IDs starting with `G`) are never returned to non-owners
- **AND** sessions from `C`-prefixed channels confirmed as private by `conversations.info` are never returned to non-owners

#### Scenario: Privacy — session owner always sees their own sessions

- **WHEN** the caller's user ID matches the `userId` of a candidate session
- **THEN** the session is always included regardless of channel privacy

#### Scenario: Type filter — public_channels

- **WHEN** Claude calls `find_recent_interactions` with `type: "public_channels"`
- **THEN** only sessions in channels confirmed public via `conversations.info` are returned (no DMs, no private channels, no channels with unknown privacy)

#### Scenario: Type filter — dm

- **WHEN** Claude calls `find_recent_interactions` with `type: "dm"`
- **THEN** only the calling user's own DM sessions are returned (no public channel sessions)

#### Scenario: Type filter — all (default)

- **WHEN** Claude calls `find_recent_interactions` with `type: "all"` or no `type`
- **THEN** public channel sessions and the calling user's own DM sessions are both included

#### Scenario: Pagination via offset

- **WHEN** Claude calls `find_recent_interactions` with an `offset` parameter
- **THEN** the system skips the first `offset` results (after sorting by recency) before applying `limit`
- **AND** this allows Claude to fetch further back in history across multiple calls

#### Scenario: Result format

- **WHEN** `find_recent_interactions` returns results
- **THEN** each result includes: `sessionId`, `channelId`, `channelName`, `triggerType` (derived from `trigger.type`), `userId`, `displayName`, `createdAt`, `lastActivity`, `firstQuestion` (derived via the `triggerText()` selector, reading `trigger.messageText` or `trigger.prompt`), `latestAssistantText` (text of the most recent `SessionAssistantMessage`, or undefined if the latest assistant turn was skipped), `messageCount`, `assistantTurnCount`, and `skippedTurnCount`
- **AND** the result does NOT include the full `trigger` object, `payload`, `blocks`, `toolCalls`, or the complete `messages` array — callers fetch the full transcript via `find_session_transcript`

#### Scenario: Empty results

- **WHEN** no sessions match the filters or keywords
- **THEN** the tool returns an empty array with no error

#### Scenario: Scan cap on persisted sessions

- **WHEN** `find_recent_interactions` is called
- **THEN** the system SHALL stat each session directory, sort by modification time descending, and only load the `SCAN_LIMIT` most-recent session `context.json` files
- **AND** sessions older than this cap are not considered for results (they remain on disk for other tools)
- **AND** the cap exists to bound query cost as the session corpus grows
