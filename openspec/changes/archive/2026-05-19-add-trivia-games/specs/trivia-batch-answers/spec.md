## MODIFIED Requirements

### Requirement: Batch answer submission

The system SHALL provide a `submit_answers` MCP tool (member role) that accepts a game name, a question ID, a Slack message link, a posted-at timestamp, and an array of user answers.

The tool SHALL accept a required `game: string` argument. The name SHALL be validated against `config.trivia.games[]` per the `trivia-games` capability:
- Unknown name → structured "unknown game" error.
- `enabled: false` entry → structured "game is disabled" error (write tool).

The target question is looked up in `data/plugins/trivia/games/<game>/questions.json`. New answer records are appended to `data/plugins/trivia/games/<game>/answers.json`.

When `trivia.seasons.enabled` is `true` AND `findCurrentSeason(games/<game>/seasons.json, now)` returns a season, each new entry written to the game's `answers.json` SHALL include a `season: string` field equal to that season's slug. When seasons are disabled OR `findCurrentSeason` returns `null` (gap) for the game's timeline, no `season` field SHALL be written.

#### Scenario: Submit batch of answers scoped to a game

- **WHEN** `submit_answers` is called with `game: "main", questionId, messageLink, postedAt`, and an array of 3 answers
- **THEN** all 3 answers are recorded in `games/main/answers.json` with correctness computed against the matching question's `isTrue` field from `games/main/questions.json`

#### Scenario: Question not found in the named game

- **WHEN** `submit_answers` is called with `game: "main", questionId: "q-from-sandbox"` where the question only exists in `games/sandbox/questions.json`
- **THEN** the tool returns an error indicating the question was not found

#### Scenario: Unknown game rejected

- **WHEN** `submit_answers` is called with `game: "ghost"`
- **THEN** the tool returns a structured "unknown game" error

#### Scenario: Disabled game refuses the write

- **GIVEN** `config.trivia.games[]` contains `{ name: "retired", enabled: false, ... }`
- **WHEN** `submit_answers` is called with `game: "retired"` and otherwise-valid args
- **THEN** the tool returns a structured "game is disabled" error

#### Scenario: Duplicate answer for same user and question within a game

- **WHEN** a user has already answered a question in `games/main/answers.json` and another `submit_answers` call with `game: "main"` includes their answer
- **THEN** the duplicate answer is skipped

#### Scenario: Same user can answer matching-id questions in different games

- **GIVEN** user `U1` has an answer for `questionId: "qabc"` in `games/main/answers.json`
- **AND** a different question with the same `id: "qabc"` exists in `games/sandbox/questions.json`
- **WHEN** `submit_answers` is called with `game: "sandbox", questionId: "qabc"` and an answer from `U1`
- **THEN** the call is treated as a first answer for `U1` in the sandbox game (the main-game answer is not a duplicate signal)

#### Scenario: New answers carry the current season tag when seasons are enabled

- **GIVEN** `trivia.seasons.enabled` is `true` and `games/main/seasons.json` has a current slug `"august-2026"`
- **WHEN** `submit_answers` is called with `game: "main"` and records three new answer entries
- **THEN** each entry in `games/main/answers.json` includes `season: "august-2026"`

#### Scenario: New answers carry no season tag when seasons are disabled

- **GIVEN** `trivia.seasons.enabled` is `false`
- **WHEN** `submit_answers` is called with `game: "main"`
- **THEN** the new entries in `games/main/answers.json` contain no `season` field

### Requirement: Auto-register users on answer submission

The system SHALL auto-register or update users from the answer payload. Each answer entry includes `userId` and `displayName`. User records SHALL be written to the global `data/plugins/trivia/users.json` — users are NOT scoped per-game.

#### Scenario: New user submits answer in any game

- **WHEN** `submit_answers` includes an answer from a user not in the global `users.json`
- **THEN** the user is created in the global `users.json` and is visible to subsequent calls in any game

#### Scenario: Existing user submits answer

- **WHEN** `submit_answers` includes an answer from a user already in the global `users.json`
- **THEN** the user's `displayName` is updated globally (regardless of which game the answer was submitted to)

### Requirement: Stamp question with posting metadata

The system SHALL set `postedAt` and `messageLink` on the question record in `data/plugins/trivia/games/<game>/questions.json` when `submit_answers` is first called for that question.

#### Scenario: First submission for a question

- **WHEN** `submit_answers` is called with `game: "main"` for a question in `games/main/questions.json` that has no `postedAt` set
- **THEN** the question record in `games/main/questions.json` is updated with the provided `postedAt` and `messageLink`

#### Scenario: Subsequent submission for same question

- **WHEN** `submit_answers` is called for a question that already has `postedAt` set
- **THEN** the question's `postedAt` and `messageLink` are not overwritten

### Requirement: Submit answers returns per-user results

The `submit_answers` tool SHALL return correctness and updated stats for each submitted answer. All stat aggregations SHALL be computed exclusively over the named game's `answers.json` — per-user totals are scoped to that game.

When `trivia.seasons.enabled` is `true` AND `findCurrentSeason(games/<game>/seasons.json, now)` returns a season, the per-user result entries SHALL include both **game-all-time** totals (`totalCorrect`, `totalAnswered`) and **game-current-season** totals (`currentSeasonCorrect`, `currentSeasonAnswered`), plus `currentStreak`.

When seasons are disabled OR `findCurrentSeason` returns `null` (gap), the per-user result entries SHALL include only `totalCorrect`, `totalAnswered`, and `currentStreak`.

#### Scenario: Mixed correct and incorrect answers, seasons disabled

- **GIVEN** `trivia.seasons.enabled` is `false`
- **WHEN** `submit_answers` is called with `game: "main"` and answers where some are correct and some are incorrect
- **THEN** the result includes per-user entries with `correct`, `totalCorrect`, `totalAnswered`, and `currentStreak`
- **AND** the totals reflect each user's history within `games/main/answers.json` only

#### Scenario: Mixed answers, seasons enabled, returns both totals scoped to the game

- **GIVEN** `trivia.seasons.enabled` is `true` and `games/main/seasons.json` has a current slug `"august-2026"`
- **AND** user U1 has 18 prior correct answers in `games/main/answers.json`, 3 of which are tagged `"august-2026"`
- **AND** user U1 also has 5 correct answers in `games/sandbox/answers.json` (irrelevant)
- **WHEN** `submit_answers` is called with `game: "main"` and records a new correct answer for U1
- **THEN** the per-user result for U1 reports `totalCorrect: 19` (sandbox excluded)
- **AND** `currentSeasonCorrect: 4`
- **AND** `currentStreak` is present (computed over `games/main/answers.json` only)

### Requirement: Retrieve scores tool

The Trivia plugin SHALL expose a `retrieve_scores` MCP tool gated to the `member` role that returns a per-user leaderboard scoped to a specific game.

The tool SHALL accept a required `game: string` argument. The name SHALL be validated against `config.trivia.games[]`:
- Unknown name → structured "unknown game" error.
- `enabled: false` entry → success (read tool — frozen archive).

All leaderboard aggregation SHALL be computed exclusively over `data/plugins/trivia/games/<game>/answers.json`. Cross-game scoring is not supported.

The tool SHALL accept an optional `season` parameter with the same semantics as the prior `season`-aware tool (`"current"` / `"all"` / specific slug), now scoped to the named game's `seasons.json` for resolving `"current"`.

The tool SHALL return `leaderboard` (one entry per user with at least one entry in the filtered set, sorted by current-season correct count descending when applicable). Each entry contains `userId`, `displayName`, `totalCorrect`, `totalAnswered`, and (when seasons are enabled and the filter is not `"all"`) `currentSeasonCorrect` and `currentSeasonAnswered` — all computed within the named game.

#### Scenario: Default season parameter is "current" within the game

- **GIVEN** `seasons.enabled` is `true` and `games/main/seasons.json` has current slug `"august-2026"`
- **WHEN** `retrieve_scores` is called with `game: "main"` and no `season` parameter
- **THEN** the leaderboard contains only users who have at least one answer in `games/main/answers.json` tagged `"august-2026"`
- **AND** ordering is by `currentSeasonCorrect` descending

#### Scenario: Explicit season "all" returns cross-season leaderboard within the game

- **WHEN** `retrieve_scores` is called with `game: "main", season: "all"`
- **THEN** the leaderboard contains every user with at least one entry in `games/main/answers.json`
- **AND** `totalCorrect` reflects each user's all-time correct count within the `main` game

#### Scenario: Cross-game scoring not supported

- **GIVEN** user `U1` has 5 correct answers in `games/main/answers.json` and 3 correct in `games/sandbox/answers.json`
- **WHEN** `retrieve_scores` is called with `game: "sandbox"`
- **THEN** the U1 entry reports `totalCorrect: 3`, not 8

#### Scenario: Unknown game rejected

- **WHEN** `retrieve_scores` is called with `game: "ghost"`
- **THEN** the tool returns a structured "unknown game" error

#### Scenario: Disabled game allows score retrieval (frozen archive)

- **GIVEN** `config.trivia.games[]` contains `{ name: "retired", enabled: false, ... }`
- **WHEN** `retrieve_scores` is called with `game: "retired"`
- **THEN** the tool returns the historical leaderboard from `games/retired/answers.json`

#### Scenario: Seasons disabled — season parameter is ignored

- **GIVEN** `seasons.enabled` is `false`
- **WHEN** `retrieve_scores` is called with `game: "main", season: "anything"`
- **THEN** the leaderboard groups across the entire `games/main/answers.json` without any filter

#### Scenario: displayName falls back to userId when user record missing

- **GIVEN** `games/main/answers.json` contains entries for `U999` and the global `users.json` has no record
- **WHEN** `retrieve_scores` is called with `game: "main"`
- **THEN** the U999 leaderboard entry has `displayName: "U999"`

#### Scenario: Tool is gated to member

- **WHEN** a session's user has role `member` (or higher)
- **THEN** `retrieve_scores` appears in the session's MCP catalog
