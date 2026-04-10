# find-recent-interactions Specification

## Purpose
Query tool that searches persisted Q&A session history, enabling Claude to recover context from prior interactions with privacy-aware filtering.

## Requirements

### Requirement: Find Recent Interactions Tool
The system SHALL provide a `find_recent_interactions` query tool that searches persisted Q&A session history so Claude can recover context from prior interactions.

#### Scenario: Returns sessions matching keywords
- **WHEN** Claude calls `find_recent_interactions` with a `keywords` parameter
- **THEN** the system returns only sessions where the keyword string appears (case-insensitive) in `originalQuestion`, any entry in `refinements`, or `lastAnswer`

#### Scenario: Returns all recent sessions when no keywords given
- **WHEN** Claude calls `find_recent_interactions` without a `keywords` parameter
- **THEN** the system returns sessions sorted by `createdAt` descending, up to `limit`

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
- **THEN** each result includes: `sessionId`, `channelName`, `triggerType`, `userId`, `displayName`, `createdAt`, `question` (originalQuestion), `refinements`, `answer` (lastAnswer)

#### Scenario: Empty results
- **WHEN** no sessions match the filters or keywords
- **THEN** the tool returns an empty array with no error

#### Scenario: Scan cap on persisted sessions
- **WHEN** `find_recent_interactions` is called
- **THEN** the system SHALL stat each session directory, sort by modification time descending, and only load the `SCAN_LIMIT` most-recent session `context.json` files
- **AND** sessions older than this cap are not considered for results (they remain on disk for other tools)
- **AND** the cap exists to bound query cost as the session corpus grows
