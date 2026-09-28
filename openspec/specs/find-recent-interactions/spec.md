# find-recent-interactions Specification

## Purpose
Query tool that searches persisted Q&A session history, enabling Claude to recover context from prior interactions with privacy-aware filtering.
## Requirements
### Requirement: Find Recent Interactions Tool

The system SHALL provide a `find_recent_interactions` query tool that searches persisted Q&A session history so Claude can recover context from prior interactions. The tool returns a lightweight summary per session derived from the session's `trigger` metadata and `messages[]` log; full transcripts are retrieved separately via `find_session_transcript`. The tool's top-level result is an object projected to the sections the caller requested via the `include` parameter (see the "Result projection via include sections" requirement); the entries section — when present — is an array of the per-session summaries described below.

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

- **WHEN** `find_recent_interactions` returns entries
- **THEN** the result is an object containing an `entries` array, and each entry includes: `sessionId`, `channelId`, `channelName`, `triggerType` (derived from `trigger.type`), `userId`, `displayName`, `createdAt`, `lastActivity`, `firstQuestion` (derived via the `triggerText()` selector, reading `trigger.messageText` or `trigger.prompt`), `latestAssistantText` (text of the most recent `SessionAssistantMessage`, or undefined if the latest assistant turn was skipped), `messageCount`, `assistantTurnCount`, and `skippedTurnCount`
- **AND** the entry does NOT include the full `trigger` object, `payload`, `blocks`, `toolCalls`, or the complete `messages` array — callers fetch the full transcript via `find_session_transcript`

#### Scenario: Empty results

- **WHEN** no sessions match the filters or keywords
- **AND** the entries section was requested
- **THEN** the tool returns an object whose `entries` array is empty, with no error

#### Scenario: Scan cap on persisted sessions

- **WHEN** `find_recent_interactions` is called
- **THEN** the system SHALL stat each session directory, sort by modification time descending, and only load the `SCAN_LIMIT` most-recent session `context.json` files
- **AND** sessions older than this cap are not considered for results (they remain on disk for other tools)
- **AND** the cap exists to bound query cost as the session corpus grows

### Requirement: Filter by minimum creation time

The system SHALL accept an optional `since` parameter on `find_recent_interactions` — an epoch-millisecond lower bound on `createdAt`. When provided, only sessions created at or after `since` are returned. This lets a caller scope results to a time window (e.g. an idler reporting window) without paging.

#### Scenario: Sessions before `since` are excluded

- **WHEN** Claude calls `find_recent_interactions` with a `since` timestamp
- **THEN** only sessions whose `createdAt >= since` are returned
- **AND** all other filters (channel, trigger type, privacy) still apply

#### Scenario: No `since` returns the full recent window

- **WHEN** Claude calls `find_recent_interactions` without `since`
- **THEN** results are not bounded below by creation time (existing behavior)

### Requirement: Result projection via include sections

The system SHALL accept an optional `include` parameter on `find_recent_interactions` — an array whose values are drawn from `"entries"` and `"usage"`, defaulting to `["entries"]`. An empty or absent `include` SHALL be treated as `["entries"]` so the tool never returns a contentless object. The tool SHALL return a single object containing exactly the requested sections and no others:

- `"entries"` → an `entries` array of the per-session summaries (subject to `limit`/`offset` pagination and all active filters).
- `"usage"` → a `totalUsage` object aggregating the `usage` of every session that matches ALL active filters (the full matched set, not only the paginated page). "Matches all filters" includes `since`, so a window-scoped query reflects only in-window usage. The aggregate SHALL sum `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheCreationTokens`, and `costUsd`, treating sessions without a `usage` field as contributing zero. When the matched set is empty, `totalUsage` SHALL still be present with every component equal to `0`.

`totalUsage` SHALL additionally carry two server-computed fields so callers never do arithmetic or formatting on the components:

- `totalTokens` — the sum of `inputTokens`, `outputTokens`, `cacheReadTokens`, and `cacheCreationTokens`.
- `summary` — a human-readable string of the form `~$<costUsd to 2 decimals> · <totalTokens> tokens (<cacheReadTokens> cached)`. Token counts below 1,000 SHALL render as plain integers; counts of 1,000 or more SHALL render with three significant digits and a `K` (thousands) or `M` (millions) suffix; a value that would round to 1000 in its unit SHALL move up to the next suffix (999,999 → `1.00M`). The `(<cacheReadTokens> cached)` part SHALL be omitted when `cacheReadTokens` is `0`.

Requesting `"usage"` without `"entries"` SHALL compute and return `totalUsage` alone and SHALL NOT load, summarize, or return any entry payloads — yielding a bounded, fixed-size result regardless of how many sessions matched or how large their prompts are. This is the supported way to tally usage over a window without risking the tool-result size cap.

#### Scenario: Usage-only projection returns a bounded aggregate

- **WHEN** Claude calls `find_recent_interactions` with `include: ["usage"]`
- **THEN** the result is an object containing `totalUsage` and NO `entries` field
- **AND** `totalUsage` sums the usage of every session matching the active filters (including `since`), independent of `limit`/`offset`
- **AND** no per-session entry summaries are computed or returned, so the payload size is independent of the matched-set size

#### Scenario: Entries-only projection is the default

- **WHEN** Claude calls `find_recent_interactions` without `include` (or with `include: ["entries"]`)
- **THEN** the result is an object containing an `entries` array and NO `totalUsage` field

#### Scenario: Empty include array is treated as the default

- **WHEN** Claude calls `find_recent_interactions` with `include: []`
- **THEN** the tool treats it as the default `["entries"]` and returns an object containing an `entries` array (never a contentless object)

#### Scenario: Both sections requested

- **WHEN** Claude calls `find_recent_interactions` with `include: ["entries", "usage"]`
- **THEN** the result is an object containing both an `entries` array (paginated) and a `totalUsage` aggregate (over the full matched set)

#### Scenario: Usage-less sessions contribute zero

- **WHEN** the matched set includes sessions that have no `usage` field
- **AND** `"usage"` is in `include`
- **THEN** those sessions contribute zero to every component of `totalUsage` and do not cause an error

#### Scenario: Empty matched set returns a zero usage aggregate

- **WHEN** Claude calls `find_recent_interactions` with `"usage"` in `include` and no session matches the filters
- **THEN** the result includes `totalUsage` with every component (`inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheCreationTokens`, `costUsd`) and `totalTokens` equal to `0`
- **AND** `summary` is `~$0.00 · 0 tokens`

#### Scenario: Aggregate carries a token total and a formatted summary

- **WHEN** the matched sessions sum to input 84, output 7,378, cache read 5,093,006, cache creation 425,833, and cost 2.932
- **THEN** `totalUsage.totalTokens` is 5,526,301
- **AND** `totalUsage.summary` is `~$2.93 · 5.53M tokens (5.09M cached)`

#### Scenario: Small counts render as plain integers without a cached part

- **WHEN** the matched sessions sum to input 100, output 50, no cache tokens, and cost 0.01
- **THEN** `totalUsage.summary` is `~$0.01 · 150 tokens`

#### Scenario: Rounding up to 1000 moves to the next suffix

- **WHEN** the matched sessions sum to 999,999 total tokens (none cache reads) and cost 1.5
- **THEN** `totalUsage.summary` is `~$1.50 · 1.00M tokens`, never `1000K`

#### Scenario: Sub-cent cost renders as an approximate zero

- **WHEN** the matched sessions sum to 12,300 total tokens (none cache reads) and cost 0.003
- **THEN** `totalUsage.summary` is `~$0.00 · 12.3K tokens`

