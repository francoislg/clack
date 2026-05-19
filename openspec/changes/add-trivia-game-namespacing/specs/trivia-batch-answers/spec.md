## MODIFIED Requirements

### Requirement: Batch answer submission

The system SHALL provide a `submit_answers` MCP tool (member role) that accepts a game slug, a question ID, a Slack message link, a posted-at timestamp, and an array of user answers.

The tool SHALL accept a required `game: string` argument; the slug SHALL be validated against the games registry per the `trivia-games` capability (unknown slug → structured error; disabled slug → structured "game is disabled" error). The target question is looked up in `data/plugins/trivia/games/<game>/questions.json`. New answer records are appended to `data/plugins/trivia/games/<game>/answers.json` — never to a flat-file `answers.json` at the trivia root, and never to another game's file.

When `trivia.seasons.enabled` is `true` AND `findCurrentSeason(games/<game>/seasons.json, now)` returns a season, each new entry written to the game's `answers.json` SHALL include a `season: string` field equal to that season's slug. When seasons are disabled OR `findCurrentSeason` returns `null` (timeline gap) for the game's timeline, no `season` field SHALL be written on new answer entries.

#### Scenario: Submit batch of answers scoped to a game

- **WHEN** `submit_answers` is called with `game: "main", questionId, messageLink, postedAt`, and an array of 3 answers
- **THEN** all 3 answers are recorded in `games/main/answers.json` with correctness computed against the matching question's `isTrue` field from `games/main/questions.json`
- **AND** no other game's `answers.json` is touched

#### Scenario: Question not found in the named game

- **WHEN** `submit_answers` is called with `game: "main", questionId: "q-from-sandbox"` where `q-from-sandbox` only exists in `games/sandbox/questions.json`
- **THEN** the tool returns an error indicating the question was not found
- **AND** no data from `games/sandbox/` is consulted for correctness

#### Scenario: Unknown game rejected

- **WHEN** `submit_answers` is called with `game: "ghost"` (not in the registry)
- **THEN** the tool returns a structured "unknown game" error
- **AND** no file is created or modified

#### Scenario: Disabled game refuses the write

- **GIVEN** `games.json` marks `retired-2025` as `disabled: true`
- **WHEN** `submit_answers` is called with `game: "retired-2025"` and otherwise-valid args
- **THEN** the tool returns a structured "game is disabled" error
- **AND** `games/retired-2025/answers.json` is unchanged

#### Scenario: Duplicate answer for same user and question within a game

- **WHEN** a user has already answered a question in `games/main/answers.json` and another `submit_answers` call with `game: "main"` includes their answer for the same question
- **THEN** the duplicate answer is skipped

#### Scenario: Same user can answer matching-id questions in different games independently

- **GIVEN** user `U1` has an answer for `questionId: "qabc"` in `games/main/answers.json`
- **AND** a different question with `id: "qabc"` exists in `games/sandbox/questions.json`
- **WHEN** `submit_answers` is called with `game: "sandbox", questionId: "qabc"` and an answer from `U1`
- **THEN** the call is treated as a first answer for `U1` in the sandbox game (the main-game answer is not a duplicate signal)

#### Scenario: New answers carry the current season tag when seasons are enabled for the game

- **GIVEN** `trivia.seasons.enabled` is `true` and `games/main/seasons.json` has a current entry with slug `"august-2026"`
- **WHEN** `submit_answers` is called with `game: "main"` and records three new answer entries
- **THEN** each new entry in `games/main/answers.json` includes `season: "august-2026"`

#### Scenario: New answers carry no season tag when seasons are disabled

- **GIVEN** `trivia.seasons.enabled` is `false`
- **WHEN** `submit_answers` is called with `game: "main"` and records new answer entries
- **THEN** the new entries in `games/main/answers.json` contain no `season` field

### Requirement: Auto-register users on answer submission

The system SHALL auto-register or update users from the answer payload. Each answer entry includes `userId` and `displayName`. User records SHALL be written to the global `data/plugins/trivia/users.json` — users are NOT scoped per-game.

#### Scenario: New user submits answer

- **WHEN** `submit_answers` includes an answer from a user not in the global `users.json`
- **THEN** the user is created in the global `users.json` with the provided `displayName` and current timestamp as `joinedAt`
- **AND** the user is visible to subsequent calls in any game

#### Scenario: Existing user submits answer

- **WHEN** `submit_answers` includes an answer from a user already in the global `users.json`
- **THEN** the user's `displayName` is updated to the provided value (regardless of which game the answer was submitted to)

### Requirement: Stamp question with posting metadata

The system SHALL set `postedAt` and `messageLink` on the question record when `submit_answers` is first called for that question. The update SHALL be applied to the matching question record in `data/plugins/trivia/games/<game>/questions.json`.

#### Scenario: First submission for a question

- **WHEN** `submit_answers` is called with `game: "main"` for a question in `games/main/questions.json` that has no `postedAt` set
- **THEN** the question record in `games/main/questions.json` is updated with the provided `postedAt` and `messageLink`

#### Scenario: Subsequent submission for same question

- **WHEN** `submit_answers` is called with `game: "main"` for a question that already has `postedAt` set
- **THEN** the question's `postedAt` and `messageLink` are not overwritten

### Requirement: Submit answers returns per-user results

The `submit_answers` tool SHALL return correctness and updated stats for each submitted answer. All stat aggregations SHALL be computed exclusively over the named game's `answers.json` — per-user totals are scoped to that game.

When `trivia.seasons.enabled` is `true` AND `findCurrentSeason(games/<game>/seasons.json, now)` returns a season, the per-user result entries SHALL include both **game-all-time** totals (`totalCorrect`, `totalAnswered`) and **game-current-season** totals (`currentSeasonCorrect`, `currentSeasonAnswered`), plus `currentStreak`. Game-all-time totals SHALL be computed across every entry in the game's `answers.json` for the user (no season filter); game-current-season totals SHALL be computed across entries whose `season` matches the active season's slug.

When seasons are disabled OR `findCurrentSeason` returns `null` (gap) for the game's timeline, the per-user result entries SHALL include only `totalCorrect`, `totalAnswered`, and `currentStreak` (the prior shape).

#### Scenario: Mixed correct and incorrect answers, seasons disabled

- **GIVEN** `trivia.seasons.enabled` is `false`
- **WHEN** `submit_answers` is called with `game: "main"` and answers where some are correct and some are incorrect
- **THEN** the result includes per-user entries with `correct`, `totalCorrect`, `totalAnswered`, and `currentStreak`
- **AND** the totals reflect each user's history within `games/main/answers.json` only (not across other games)
- **AND** no `currentSeasonCorrect` or `currentSeasonAnswered` fields are present

#### Scenario: Mixed answers, seasons enabled, returns both totals scoped to the game

- **GIVEN** `trivia.seasons.enabled` is `true` and `games/main/seasons.json` has a current entry with slug `"august-2026"`
- **AND** user U1 has 18 prior correct answers in `games/main/answers.json`, 3 of which are tagged `"august-2026"`
- **AND** user U1 also has 5 correct answers in `games/sandbox/answers.json` (irrelevant to this call)
- **WHEN** `submit_answers` is called with `game: "main"` and records a new correct answer for U1
- **THEN** the per-user result for U1 reports `totalCorrect: 19` (sandbox entries excluded)
- **AND** `currentSeasonCorrect: 4`
- **AND** `currentSeasonAnswered` reflects only `"august-2026"` entries in `games/main/answers.json`
- **AND** `currentStreak` is present (computed over `games/main/answers.json` only)

### Requirement: Retrieve scores tool

The Trivia plugin SHALL expose a `retrieve_scores` MCP tool gated to the `member` role that returns a per-user leaderboard suitable for the reveal-time leaderboard rendering, scoped to a specific game.

The tool SHALL accept a required `game: string` argument; the slug SHALL be validated against the games registry per the `trivia-games` capability (unknown slug → structured error). The tool SHALL succeed against disabled games (frozen-archive read). All leaderboard aggregation SHALL be computed exclusively over `data/plugins/trivia/games/<game>/answers.json` — cross-game scoring is not supported.

The tool SHALL accept an optional `season` parameter (string, optional):

- When `season` is omitted AND seasons are enabled AND `findCurrentSeason(games/<game>/seasons.json, now)` returns a season, the default SHALL be `"current"`.
- When `season` is `"current"`, the tool SHALL filter the game's `answers.json` to entries whose `season` matches the game's currently-active season's slug.
- When `season` is `"all"`, the tool SHALL NOT apply any season filter (groups across the entire game's `answers.json`).
- When `season` is any other string, the tool SHALL filter the game's `answers.json` to entries whose `season` exactly matches the provided value.

When seasons are disabled OR `findCurrentSeason` returns `null` (gap) for the game's timeline, the `season` parameter SHALL be silently ignored and the tool SHALL group across the entire game's `answers.json` (legacy behavior).

The tool SHALL return:

- `leaderboard` (array) — one entry per user who has at least one entry in the filtered set, sorted by current-season correct count descending when applicable (or by the filtered correct count when `season` is `"all"` or a specific historical slug). Each entry contains:
  - `userId` (string)
  - `displayName` (string, resolved from the global `users.json`; falls back to `userId` if missing)
  - `totalCorrect` (number) — game-all-time correct count, regardless of the season filter
  - `totalAnswered` (number) — game-all-time answered count, regardless of the season filter
  - When `seasons.enabled` is `true` AND `findCurrentSeason` returns a season for the game AND the filter is not `"all"`: additionally `currentSeasonCorrect` and `currentSeasonAnswered`, computed over entries in the game's `answers.json` whose `season` matches the currently-active season's slug. These two fields SHALL be present even when the explicit `season` argument selects a historical slug — they always reflect *current* season participation so the caller can render a 3-row table for any view.

#### Scenario: Default season parameter is "current"

- **GIVEN** `seasons.enabled` is `true` and `games/main/seasons.json` has current slug `"august-2026"`
- **WHEN** `retrieve_scores` is called with `game: "main"` and no `season` parameter
- **THEN** the leaderboard contains only users who have at least one answer in `games/main/answers.json` tagged `"august-2026"`
- **AND** ordering is by `currentSeasonCorrect` descending

#### Scenario: Explicit season "all" returns cross-season leaderboard within the game

- **GIVEN** `seasons.enabled` is `true` with multiple historical seasons in `games/main/seasons.json`
- **WHEN** `retrieve_scores` is called with `game: "main", season: "all"`
- **THEN** the leaderboard contains every user with at least one entry in `games/main/answers.json`
- **AND** `totalCorrect` reflects each user's all-time correct count within the `main` game (sandbox entries excluded)

#### Scenario: Historical season slug filters to that season within the game

- **GIVEN** `games/main/seasons.json` history contains `{ slug: "spring-2026", ... }`
- **WHEN** `retrieve_scores` is called with `game: "main", season: "spring-2026"`
- **THEN** the leaderboard groups only entries from `games/main/answers.json` whose `season` is `"spring-2026"`
- **AND** the per-user `totalCorrect` / `totalAnswered` fields still reflect game-all-time counts (so the caller may render an all-time column even when scoped to a past season)

#### Scenario: Cross-game scoring not supported

- **GIVEN** user `U1` has 5 correct answers in `games/main/answers.json` and 3 correct answers in `games/sandbox/answers.json`
- **WHEN** `retrieve_scores` is called with `game: "sandbox"`
- **THEN** the U1 entry reports `totalCorrect: 3`, not 8 — the main-game entries are excluded

#### Scenario: Unknown game rejected

- **WHEN** `retrieve_scores` is called with `game: "ghost"` (not in the registry)
- **THEN** the tool returns a structured "unknown game" error

#### Scenario: Disabled game allows score retrieval (frozen archive)

- **GIVEN** `games.json` marks `retired-2025` as `disabled: true`
- **WHEN** `retrieve_scores` is called with `game: "retired-2025"`
- **THEN** the tool returns the historical leaderboard from `games/retired-2025/answers.json`

#### Scenario: Seasons disabled — season parameter is ignored

- **GIVEN** `seasons.enabled` is `false`
- **WHEN** `retrieve_scores` is called with `game: "main", season: "anything"`
- **THEN** the leaderboard groups across the entire `games/main/answers.json` without any filter
- **AND** no `currentSeasonCorrect` / `currentSeasonAnswered` fields appear on the entries

#### Scenario: displayName falls back to userId when user record missing

- **GIVEN** `games/main/answers.json` contains entries for user `U999` and the global `users.json` has no record for `U999`
- **WHEN** `retrieve_scores` is called with `game: "main"`
- **THEN** the U999 leaderboard entry has `displayName: "U999"`

#### Scenario: Tool is gated to member

- **WHEN** a session's user has role `member` (or higher)
- **THEN** `retrieve_scores` appears in the session's MCP catalog
