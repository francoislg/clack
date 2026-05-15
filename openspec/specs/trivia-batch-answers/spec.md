# Trivia Batch Answers

## Purpose

Batch processing of trivia answers, including user auto-registration, metadata stamping, and per-user result tracking.

## Requirements

### Requirement: Batch answer submission
The system SHALL provide a `submit_answers` MCP tool (member role) that accepts a question ID, a Slack message link, a posted-at timestamp, and an array of user answers. Each entry in the answer array SHALL include `userId` (string) and `displayName` (string), and SHALL include EITHER `answer: boolean` (for boolean questions) OR `answerIndex: number` (for choice questions) but not both. The tool SHALL determine the question's type from the stored `TriviaQuestion` record (absence of `type` field reads as `"boolean"`) and validate that each answer entry's discriminator matches the question's type. Correctness SHALL be computed as `answer === question.isTrue` for boolean questions and as `answerIndex === question.correctIndex` for choice questions.

When `trivia.seasons.enabled` is `true` AND `findCurrentSeason(state, now)` returns a season, each new entry written to `answers.json` SHALL include a `season: string` field equal to that season's slug. When seasons are disabled OR `findCurrentSeason` returns `null` (timeline gap), no `season` field SHALL be written on new answer entries.

#### Scenario: Submit batch of boolean answers
- **WHEN** `submit_answers` is called with `questionId`, `messageLink`, `postedAt`, and an array of 3 boolean answer entries (each with `answer: boolean`) for a question with `type: "boolean"` (or absent)
- **THEN** all 3 answers are recorded in `answers.json` with correctness computed against the question's `isTrue` field

#### Scenario: Submit batch of choice answers
- **WHEN** `submit_answers` is called with `questionId`, `messageLink`, `postedAt`, and an array of 3 choice answer entries (each with `answerIndex: number`) for a question with `type: "choice"` and `correctIndex: 2`
- **THEN** all 3 answers are recorded in `answers.json` with correctness computed as `answerIndex === 2`
- **AND** each stored answer record carries `answerIndex` and does NOT carry `answer`

#### Scenario: Question not found
- **WHEN** `submit_answers` is called with a `questionId` that does not exist
- **THEN** the tool returns an error indicating the question was not found

#### Scenario: Duplicate answer for same user and question
- **WHEN** a user has already answered a question and another `submit_answers` call includes their answer for the same question
- **THEN** the duplicate answer is skipped

#### Scenario: Boolean answer entry on choice question rejected
- **WHEN** `submit_answers` is called with a boolean answer entry (`answer: boolean`, no `answerIndex`) for a question with `type: "choice"`
- **THEN** the tool returns an error indicating the answer entry's shape does not match the question's type

#### Scenario: Choice answer entry on boolean question rejected
- **WHEN** `submit_answers` is called with a choice answer entry (`answerIndex: number`, no `answer`) for a question with `type: "boolean"` (or absent)
- **THEN** the tool returns an error indicating the answer entry's shape does not match the question's type

#### Scenario: answerIndex out of range rejected
- **WHEN** `submit_answers` is called with a choice answer entry whose `answerIndex` is outside `[0, question.choices.length)`
- **THEN** the tool returns an error indicating `answerIndex` is out of range

#### Scenario: New answers carry the current season tag when seasons are enabled

- **GIVEN** `trivia.seasons.enabled` is `true` and `seasons.json#current` is `"august-2026"`
- **WHEN** `submit_answers` records three new answer entries
- **THEN** each new entry in `answers.json` includes `season: "august-2026"`

#### Scenario: New answers carry no season tag when seasons are disabled

- **GIVEN** `trivia.seasons.enabled` is `false`
- **WHEN** `submit_answers` records new answer entries
- **THEN** the new entries in `answers.json` contain no `season` field

### Requirement: Auto-register users on answer submission
The system SHALL auto-register or update users from the answer payload. Each answer entry includes `userId` and `displayName`.

#### Scenario: New user submits answer
- **WHEN** `submit_answers` includes an answer from a user not in `users.json`
- **THEN** the user is created in `users.json` with the provided `displayName` and current timestamp as `joinedAt`

#### Scenario: Existing user submits answer
- **WHEN** `submit_answers` includes an answer from a user already in `users.json`
- **THEN** the user's `displayName` is updated to the provided value

### Requirement: Stamp question with posting metadata
The system SHALL set `postedAt` and `messageLink` on the question record when `submit_answers` is first called for that question.

#### Scenario: First submission for a question
- **WHEN** `submit_answers` is called for a question that has no `postedAt` set
- **THEN** the question record is updated with the provided `postedAt` and `messageLink`

#### Scenario: Subsequent submission for same question
- **WHEN** `submit_answers` is called for a question that already has `postedAt` set
- **THEN** the question's `postedAt` and `messageLink` are not overwritten

### Requirement: Submit answers returns per-user results
The `submit_answers` tool SHALL return correctness and updated stats for each submitted answer. The per-user result shape SHALL be unchanged: `{ userId, displayName, correct, skipped, totalCorrect, totalAnswered, currentStreak }`. The result SHALL NOT distinguish boolean vs choice answers — both contribute equally to `totalCorrect` and `totalAnswered`.

When `trivia.seasons.enabled` is `true` AND `findCurrentSeason(state, now)` returns a season, the per-user result entries SHALL include both **all-time** totals (`totalCorrect`, `totalAnswered`) and **current-season** totals (`currentSeasonCorrect`, `currentSeasonAnswered`), plus `currentStreak`. All-time totals SHALL be computed across every entry in `answers.json` for the user (no season filter); current-season totals SHALL be computed across entries whose `season` matches the active season's slug.

When seasons are disabled OR `findCurrentSeason` returns `null` (gap), the per-user result entries SHALL include only `totalCorrect`, `totalAnswered`, and `currentStreak` (the prior shape).

#### Scenario: Mixed correct and incorrect boolean answers

- **WHEN** `submit_answers` is called with boolean answer entries where some are correct and some are incorrect
- **THEN** the result includes per-user entries with `correct`, `totalCorrect`, `totalAnswered`, and `currentStreak`

#### Scenario: Mixed correct and incorrect choice answers

- **WHEN** `submit_answers` is called with choice answer entries where some are correct and some are incorrect
- **THEN** the result includes per-user entries with `correct`, `totalCorrect`, `totalAnswered`, and `currentStreak`
- **AND** correctness is computed by comparing each entry's `answerIndex` to the question's `correctIndex`

#### Scenario: Equal scoring across question types

- **GIVEN** a user has answered one boolean question correctly and one choice question correctly
- **WHEN** the user's stats are computed
- **THEN** `totalCorrect` is 2 and `totalAnswered` is 2 (no type-weighted differential)

#### Scenario: Mixed answers, seasons enabled, returns both totals

- **GIVEN** `trivia.seasons.enabled` is `true` and `seasons.json#current` is `"august-2026"`
- **AND** user U1 has 18 prior all-time correct answers, 3 of which are tagged `"august-2026"`
- **WHEN** `submit_answers` records a new correct answer for U1
- **THEN** the per-user result for U1 reports `totalCorrect: 19`, `totalAnswered` reflecting all-time, `currentSeasonCorrect: 4`, and `currentSeasonAnswered` reflecting only `"august-2026"` entries
- **AND** `currentStreak` is present

### Requirement: Retrieve scores tool

The Trivia plugin SHALL expose a `retrieve_scores` MCP tool gated to the `member` role that returns a per-user leaderboard suitable for the reveal-time leaderboard rendering. The tool SHALL accept an optional `season` parameter (string, optional):

- When `season` is omitted AND seasons are enabled AND `findCurrentSeason(state, now)` returns a season, the default SHALL be `"current"`.
- When `season` is `"current"`, the tool SHALL filter `answers.json` to entries whose `season` matches the currently-active season's slug (resolved via `findCurrentSeason`).
- When `season` is `"all"`, the tool SHALL NOT apply any season filter (groups across the entire `answers.json`).
- When `season` is any other string, the tool SHALL filter `answers.json` to entries whose `season` exactly matches the provided value.

When seasons are disabled OR `findCurrentSeason` returns `null` (gap), the `season` parameter SHALL be silently ignored and the tool SHALL group across the entire `answers.json` (legacy behavior).

The tool SHALL return:

- `leaderboard` (array) — one entry per user who has at least one entry in the filtered set, sorted by current-season correct count descending when applicable (or by the filtered correct count when `season` is `"all"` or a specific historical slug). Each entry contains:
  - `userId` (string)
  - `displayName` (string, resolved from `users.json`; falls back to `userId` if missing)
  - `totalCorrect` (number) — all-time correct count, regardless of the season filter
  - `totalAnswered` (number) — all-time answered count, regardless of the season filter
  - When `seasons.enabled` is `true` AND `findCurrentSeason` returns a season AND the filter is not `"all"`: additionally `currentSeasonCorrect` and `currentSeasonAnswered`, computed over entries whose `season` matches the currently-active season's slug. These two fields SHALL be present even when the explicit `season` argument selects a historical slug — they always reflect *current* season participation so the caller can render a 3-row table for any view.

#### Scenario: Default season parameter is "current"

- **GIVEN** `seasons.enabled` is `true` and `seasons.json#current` is `"august-2026"`
- **WHEN** `retrieve_scores` is called without a `season` parameter
- **THEN** the leaderboard contains only users who have at least one answer tagged `"august-2026"`
- **AND** ordering is by `currentSeasonCorrect` descending

#### Scenario: Explicit season "all" returns cross-season leaderboard

- **GIVEN** `seasons.enabled` is `true` with multiple historical seasons
- **WHEN** `retrieve_scores` is called with `season: "all"`
- **THEN** the leaderboard contains every user with at least one entry in `answers.json`
- **AND** `totalCorrect` reflects all-time correct count for each user

#### Scenario: Historical season slug filters to that season

- **GIVEN** `seasons.json#history` contains `{ slug: "spring-2026", ... }`
- **WHEN** `retrieve_scores` is called with `season: "spring-2026"`
- **THEN** the leaderboard groups only entries from `answers.json` whose `season` is `"spring-2026"`
- **AND** the per-user `totalCorrect` / `totalAnswered` fields still reflect all-time counts (so the caller may render an all-time column even when scoped to a past season)

#### Scenario: Seasons disabled — season parameter is ignored

- **GIVEN** `seasons.enabled` is `false`
- **WHEN** `retrieve_scores` is called with `season: "anything"`
- **THEN** the leaderboard groups across the entire `answers.json` without any filter
- **AND** no `currentSeasonCorrect` / `currentSeasonAnswered` fields appear on the entries

#### Scenario: displayName falls back to userId when user record missing

- **GIVEN** `answers.json` contains entries for user `U999` and `users.json` has no record for `U999`
- **WHEN** `retrieve_scores` is called
- **THEN** the U999 leaderboard entry has `displayName: "U999"`

#### Scenario: Tool is gated to member

- **WHEN** a session's user has role `member` (or higher)
- **THEN** `retrieve_scores` appears in the session's MCP catalog
