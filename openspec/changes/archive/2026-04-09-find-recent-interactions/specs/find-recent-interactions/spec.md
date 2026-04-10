## ADDED Requirements

### Requirement: Find Recent Interactions Tool
The system SHALL provide a `find_recent_interactions` query tool that searches persisted Q&A session history so Claude can recover context from prior interactions.

#### Scenario: Returns sessions matching keywords
- **WHEN** Claude calls `find_recent_interactions` with a `keywords` parameter
- **THEN** the system returns only sessions where the keyword string appears (case-insensitive) in `originalQuestion`, any entry in `refinements`, or `lastAnswer`

#### Scenario: Returns all recent sessions when no keywords given
- **WHEN** Claude calls `find_recent_interactions` without a `keywords` parameter
- **THEN** the system returns sessions sorted by `createdAt` descending, up to `limit`

#### Scenario: Privacy — public channels visible to all
- **WHEN** any user calls `find_recent_interactions`
- **THEN** sessions from public channels (Slack channel IDs starting with `C`) are included in results regardless of which user triggered them

#### Scenario: Privacy — DMs scoped to requesting user
- **WHEN** any user calls `find_recent_interactions`
- **THEN** DM sessions are only included if `userId` on the session matches the calling user's ID
- **AND** other users' DM sessions are never returned

#### Scenario: Privacy — private channels excluded
- **WHEN** any user calls `find_recent_interactions`
- **THEN** sessions from private group channels (Slack channel IDs starting with `G`) are never returned

#### Scenario: Type filter — public_channels
- **WHEN** Claude calls `find_recent_interactions` with `type: "public_channels"`
- **THEN** only sessions from public channels are returned (no DMs)

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
