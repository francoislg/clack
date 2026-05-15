## MODIFIED Requirements

### Requirement: Batch answer submission

The system SHALL provide a `submit_answers` MCP tool (member role) that accepts a question ID, a Slack message link, a posted-at timestamp, and an array of user answers.

When `trivia.seasons.enabled` is `true` AND `findCurrentSeason(state, now)` returns a season, each new entry written to `answers.json` SHALL include a `season: string` field equal to that season's slug. When seasons are disabled, OR when `findCurrentSeason` returns `null` (the gap case), no `season` field SHALL be written on new answer entries.

Otherwise the tool's signature, return shape, and duplicate-detection logic are unchanged.

#### Scenario: Submit batch of answers

- **WHEN** `submit_answers` is called with `questionId`, `messageLink`, `postedAt`, and an array of 3 answers
- **THEN** all 3 answers are recorded in `answers.json` with correctness computed against the question's `isTrue` field

#### Scenario: Question not found

- **WHEN** `submit_answers` is called with a `questionId` that does not exist
- **THEN** the tool returns an error indicating the question was not found

#### Scenario: Duplicate answer for same user and question

- **WHEN** a user has already answered a question and another `submit_answers` call includes their answer for the same question
- **THEN** the duplicate answer is skipped

#### Scenario: New answers carry the active season's tag

- **GIVEN** `trivia.seasons.enabled` is `true` and the currently-active season's slug is `"may-2026"`
- **WHEN** `submit_answers` records new answer entries
- **THEN** each new entry includes `season: "may-2026"`

#### Scenario: Answers written during a gap have no season tag

- **GIVEN** `trivia.seasons.enabled` is `true` but `findCurrentSeason` returns `null` (gap)
- **WHEN** `submit_answers` records new answer entries
- **THEN** the new entries contain no `season` field

### Requirement: Submit answers returns per-user results

The `submit_answers` tool SHALL return correctness and updated stats for each submitted answer.

When `trivia.seasons.enabled` is `true` AND `findCurrentSeason(state, now)` returns a season, the per-user result entries SHALL include both **all-time** totals (`totalCorrect`, `totalAnswered`) and **current-season** totals (`currentSeasonCorrect`, `currentSeasonAnswered`), plus `currentStreak`. Current-season totals are computed across entries whose `season` matches the active season's slug.

When seasons are disabled OR `findCurrentSeason` returns `null`, the per-user result entries SHALL include only `totalCorrect`, `totalAnswered`, and `currentStreak` (the prior shape).

#### Scenario: Mixed answers with seasons enabled

- **GIVEN** the currently-active season's slug is `"may-2026"`, U1 has 18 prior all-time correct answers, 3 of which are tagged `"may-2026"`
- **WHEN** `submit_answers` records a new correct answer for U1
- **THEN** the per-user result reports `totalCorrect: 19, currentSeasonCorrect: 4`

#### Scenario: Mixed answers during a gap

- **GIVEN** seasons enabled but `findCurrentSeason` returns `null`
- **WHEN** `submit_answers` records new answers
- **THEN** the per-user result entries omit `currentSeasonCorrect` and `currentSeasonAnswered`

### Requirement: Retrieve scores tool

The Trivia plugin SHALL expose a `retrieve_scores` MCP tool gated to the `member` role that returns a per-user leaderboard.

The tool SHALL accept an optional `season` parameter (string):

- When `season` is omitted AND seasons are enabled AND `findCurrentSeason(state, now)` returns a season, the default SHALL be `"current"`.
- When `season` is `"current"`, the tool SHALL filter `answers.json` to entries whose `season` matches the currently-active season's slug.
- When `season` is `"all"`, no filter is applied.
- When `season` is any other string, the tool SHALL filter to entries whose `season` exactly matches that slug.

When seasons are disabled OR `findCurrentSeason` returns `null`, the `season` parameter is silently ignored and the tool aggregates across the full `answers.json` (legacy behavior).

When seasons are enabled AND a current season exists AND the filter is not `"all"`, each leaderboard entry SHALL include `currentSeasonCorrect` and `currentSeasonAnswered` computed over the current season's tagged entries (independent of the season filter applied to the primary aggregation).

Other behaviors (sort order, ties, displayName fallback) are preserved.

#### Scenario: Default season filter resolves to current via findCurrentSeason

- **GIVEN** the currently-active season's slug is `"may-2026"`
- **WHEN** `retrieve_scores` is called with no `season` argument
- **THEN** the leaderboard contains only users with at least one `"may-2026"`-tagged answer
- **AND** ordering is by `currentSeasonCorrect` descending

#### Scenario: Historical-slug filter is unaffected

- **GIVEN** the timeline contains `"spring-2026"` as a past entry
- **WHEN** `retrieve_scores` is called with `season: "spring-2026"`
- **THEN** the leaderboard filters to spring-2026-tagged entries
- **AND** the per-user `totalCorrect` / `totalAnswered` reflect all-time counts (no filter), and `currentSeasonCorrect` / `currentSeasonAnswered` reflect the currently-active season's tagged entries (not spring-2026's)
