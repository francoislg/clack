# conversation-stats Specification

## Purpose
TBD - created by archiving change add-conversation-stats. Update Purpose after archive.
## Requirements
### Requirement: Conversation-stats query tool

The system SHALL provide a read-only MCP query tool `get_conversation_stats` that aggregates Clack's persisted session history into a single bundle of high-level statistics. The tool SHALL be available to all roles and MUST NOT perform any write.

#### Scenario: Tool is available to every role

- **WHEN** any user (member, dev, admin, or owner) triggers a session
- **THEN** `get_conversation_stats` is present in the tool set and callable without a role gate

#### Scenario: Returns a single aggregate bundle

- **WHEN** Claude calls `get_conversation_stats` with no arguments
- **THEN** the tool scans every `data/sessions/*/context.json` and returns one bundle containing the core, temporal, engagement, personality, content-lite, tools, and emoji stat families

#### Scenario: No sessions on disk

- **WHEN** the sessions directory is empty or missing
- **THEN** the tool returns a well-formed bundle with zero counts and empty leaderboards rather than erroring

### Requirement: Time windowing

The tool SHALL accept optional `from` and `to` arguments bounding which sessions are aggregated by their creation time. The window is **half-open**: a session is included when its creation time is `>= from` (when `from` is given) AND `< to` (when `to` is given). When both are omitted the tool SHALL aggregate all-time. Windowed queries SHALL determine a session's creation time without reading the bodies of out-of-window session files.

#### Scenario: All-time by default

- **WHEN** `get_conversation_stats` is called with neither `from` nor `to`
- **THEN** every session on disk is included in the aggregation

#### Scenario: Windowed query excludes out-of-range sessions

- **WHEN** `get_conversation_stats` is called with a `from`/`to` window
- **THEN** only sessions whose creation time is `>= from` and `< to` contribute to the bundle
- **AND** sessions outside the window are skipped without reading their `context.json` body

#### Scenario: Boundary handling

- **WHEN** a session's creation time equals `from`
- **THEN** it is included
- **WHEN** a session's creation time equals `to`
- **THEN** it is excluded

#### Scenario: Reported scan scope

- **WHEN** the tool returns its bundle
- **THEN** the bundle reports how many sessions were scanned and the effective `from`/`to` range applied

### Requirement: No content or topic leakage in output

The tool MAY read message text as input, but its output MUST NOT contain any conversation content, message text, or indication of what any user asked about. Output SHALL be limited to counts, identifiers/display names, superlatives, emoji tokens, and numeric length/word figures.

#### Scenario: Output carries no message text

- **WHEN** the tool computes content-derived stats (emoji, word counts, links, punctuation)
- **THEN** the returned bundle contains only aggregate numbers and emoji tokens, never any substring of a user or assistant message

#### Scenario: Longest-question stat is a count, not text

- **WHEN** the tool reports the longest single question
- **THEN** it returns the word count only, never the question text

### Requirement: Core statistics

The bundle SHALL include core stats: top channels by activity, top askers, top DM-askers, the longest conversation by turn count and separately by wall-clock duration, and Clack's total reply count. Asker leaderboards SHALL count only human-initiated triggers (`reactions`, `mentions`, `directMessages`) and SHALL exclude `scheduled` and `autoRespond` triggers; those excluded sessions SHALL still contribute to Clack's total reply count.

#### Scenario: Asker leaderboards exclude bot-initiated triggers

- **WHEN** the tool builds top-askers and top-DM-askers leaderboards
- **THEN** sessions whose trigger is `scheduled` or `autoRespond` do not contribute to those leaderboards
- **AND** the assistant turns from those sessions still count toward Clack's total replies

#### Scenario: Longest conversation reported two ways

- **WHEN** the tool computes the longest conversation
- **THEN** it reports both the conversation with the most turns and the conversation with the greatest wall-clock duration

#### Scenario: Leaderboards are top-N capped with a deterministic tiebreak

- **WHEN** more than 10 distinct entities qualify for a leaderboard
- **THEN** only the top 10 by the leaderboard's metric are returned, keeping the output size bounded
- **AND** entities tied on the metric are ordered deterministically (earliest-first-seen entity first, then by identifier) so repeated calls return a stable ordering

### Requirement: Temporal, engagement, personality, content-lite, tool, and emoji statistics

The bundle SHALL include the stat families below, each metric defined concretely:

- **Temporal:** busiest hour-of-day and busiest day-of-week (histograms over session `createdAt`); first-session date and active-day age (days between the earliest session and now); busiest single calendar day (date with the most sessions); after-midnight count (sessions whose `createdAt` local hour is in `[0,5)`).
- **Engagement:** follow-up rate (fraction of sessions with more than one user turn); marathoner (the user with the most multi-turn sessions); distinct-user and distinct-channel reach (counts of unique ids seen); times Clack stayed quiet (total assistant turns flagged `skipped`).
- **Personality** (human-trigger sessions only — see asker-exclusion rule): most inquisitive (user with the highest total count of `?` across their messages); most excitable (highest total count of `!`); politest (highest total count of politeness markers — `please`, `stp`, `svp`, `s'il vous plaît`, case-insensitive); most verbose (highest average words per message).
- **Content-lite:** links shared (total count of `http(s)://` occurrences in user-authored text); longest single question (the maximum word count of any single user-authored message, reported as a number only).
- **Tools:** favourite tool (the most frequently named tool across all assistant `toolCalls`); hardest-working session (the highest tool-call count in any single session).
- **Emoji:** team's top emoji (from user-authored text) and Clack's signature emoji (from assistant-authored text). Emoji extraction SHALL ignore numeric-only `:shortcodes:` (e.g. `:22:`) and non-emoji symbols (e.g. arrows), while still extracting valid emoji that co-occur with them.

Word-count and verbosity metrics SHALL exclude the large `scheduled`-trigger prompt text so cron prompts do not inflate them.

#### Scenario: Emoji split by author

- **WHEN** the tool computes emoji stats
- **THEN** the team's top emoji are derived only from user-authored text and Clack's signature emoji only from assistant-authored text

#### Scenario: Emoji false positives are filtered

- **WHEN** message text contains numeric-only shortcodes (e.g. `:22:`) or non-emoji symbols (e.g. arrows)
- **THEN** those tokens are excluded from the emoji leaderboards

#### Scenario: Verbosity stats exclude cron prompts

- **WHEN** the tool computes word-count and verbosity stats
- **THEN** large `scheduled` trigger prompts do not inflate the figures

### Requirement: Bounded-memory streaming scan

The tool SHALL aggregate sessions by reading and folding them with bounded concurrency, holding only a bounded number of session files in memory at once, so that peak memory does not grow with total history size. A session file that fails to parse SHALL be skipped without aborting the scan.

#### Scenario: Memory stays bounded as history grows

- **WHEN** the tool scans a large session history
- **THEN** it holds at most a bounded read-ahead window of sessions in memory plus the fixed-size accumulators, never the entire history at once

#### Scenario: Corrupt session file is skipped

- **WHEN** a `context.json` is malformed or unreadable
- **THEN** the tool skips that file, logs the issue, and continues aggregating the remaining sessions

### Requirement: Display labels

Leaderboard entries SHALL use the human-readable display name (for users) and channel name (for channels) cached on the session, falling back to the bare Slack ID when no cached label is present. The tool SHALL NOT perform live Slack lookups to resolve labels.

#### Scenario: Cached label is used

- **WHEN** a session carries a cached `displayName` or `channelName`
- **THEN** the corresponding leaderboard entry shows that label

#### Scenario: Fallback to ID

- **WHEN** a session has no cached label for its user or channel
- **THEN** the leaderboard entry shows the bare Slack ID and the tool makes no live lookup

