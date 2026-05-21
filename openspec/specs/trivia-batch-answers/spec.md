# Trivia Batch Answers

## Purpose

Batch processing of trivia answers, including user auto-registration, metadata stamping, and per-user result tracking. All operations are scoped per-game: every tool takes a required `game: string` argument and reads/writes target `data/plugins/trivia/games/<name>/`. The global `users.json` continues to receive auto-registration writes.

## Requirements

### Requirement: Batch answer submission

The system SHALL provide a `submit_answers` MCP tool (member role) that accepts a game name, a question ID, a Slack message link, a posted-at timestamp, and an array of user answers. Each entry in the answer array SHALL include `userId` (string) and `displayName` (string), and SHALL include EITHER `answer: boolean` (for boolean questions) OR `answerIndex: number` (for choice questions) but not both. The tool SHALL determine the question's type from the stored `TriviaQuestion` record (absence of `type` field reads as `"boolean"`) and validate that each answer entry's discriminator matches the question's type. Correctness SHALL be computed as `answer === question.isTrue` for boolean questions and as `answerIndex === question.correctIndex` for choice questions.

The tool SHALL accept a required `game: string` argument. The name SHALL be validated against `config.trivia.games[]` per the `trivia-games` capability:
- Unknown name → structured "unknown game" error.
- `enabled: false` entry → structured "game is disabled" error (write tool).

The target question is looked up in `data/plugins/trivia/games/<game>/questions.json`. New answer records are appended to `data/plugins/trivia/games/<game>/answers.json`.

When `trivia.seasons.enabled` is `true` AND `findCurrentSeason(games/<game>/seasons.json, now)` returns a season, each new entry written to the game's `answers.json` SHALL include a `season: string` field equal to that season's slug. When seasons are disabled OR `findCurrentSeason` returns `null` (timeline gap), no `season` field SHALL be written on new answer entries.

#### Scenario: Submit batch of boolean answers scoped to a game

- **WHEN** `submit_answers` is called with `game: "main", questionId, messageLink, postedAt`, and an array of 3 boolean answer entries (each with `answer: boolean`) for a question with `type: "boolean"` (or absent)
- **THEN** all 3 answers are recorded in `games/main/answers.json` with correctness computed against the question's `isTrue` field

#### Scenario: Submit batch of choice answers scoped to a game

- **WHEN** `submit_answers` is called with `game: "main", questionId, messageLink, postedAt`, and an array of 3 choice answer entries (each with `answerIndex: number`) for a question with `type: "choice"` and `correctIndex: 2`
- **THEN** all 3 answers are recorded in `games/main/answers.json` with correctness computed as `answerIndex === 2`
- **AND** each stored answer record carries `answerIndex` and does NOT carry `answer`

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

#### Scenario: Boolean answer entry on choice question rejected

- **WHEN** `submit_answers` is called with a boolean answer entry (`answer: boolean`, no `answerIndex`) for a question with `type: "choice"`
- **THEN** the tool returns an error indicating the answer entry's shape does not match the question's type

#### Scenario: Choice answer entry on boolean question rejected

- **WHEN** `submit_answers` is called with a choice answer entry (`answerIndex: number`, no `answer`) for a question with `type: "boolean"` (or absent)
- **THEN** the tool returns an error indicating the answer entry's shape does not match the question's type

#### Scenario: answerIndex out of range rejected

- **WHEN** `submit_answers` is called with a choice answer entry whose `answerIndex` is outside `[0, question.choices.length)`
- **THEN** the tool returns an error indicating `answerIndex` is out of range

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

#### Scenario: New user submits answer in any game

- **WHEN** `submit_answers` includes an answer from a user not in the global `users.json`
- **THEN** the user is created in the global `users.json` with the provided `displayName` and current timestamp as `joinedAt`
- **AND** the user is visible to subsequent calls in any game

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

The `submit_answers` tool SHALL return correctness and updated stats for each submitted answer. The per-user result shape SHALL be unchanged: `{ userId, displayName, correct, skipped, totalCorrect, totalAnswered, currentStreak }`. The result SHALL NOT distinguish boolean vs choice answers — both contribute equally to `totalCorrect` and `totalAnswered`. All stat aggregations SHALL be computed exclusively over the named game's `answers.json` — per-user totals are scoped to that game.

When `trivia.seasons.enabled` is `true` AND `findCurrentSeason(games/<game>/seasons.json, now)` returns a season, the per-user result entries SHALL include both **game-all-time** totals (`totalCorrect`, `totalAnswered`) and **game-current-season** totals (`currentSeasonCorrect`, `currentSeasonAnswered`), plus `currentStreak`. Game-all-time totals SHALL be computed across every entry in the game's `answers.json` for the user (no season filter); game-current-season totals SHALL be computed across entries whose `season` matches the active season's slug.

When seasons are disabled OR `findCurrentSeason` returns `null` (gap) for the game's timeline, the per-user result entries SHALL include only `totalCorrect`, `totalAnswered`, and `currentStreak` (the prior shape).

#### Scenario: Mixed correct and incorrect boolean answers, seasons disabled

- **GIVEN** `trivia.seasons.enabled` is `false`
- **WHEN** `submit_answers` is called with `game: "main"` and boolean answer entries where some are correct and some are incorrect
- **THEN** the result includes per-user entries with `correct`, `totalCorrect`, `totalAnswered`, and `currentStreak`
- **AND** the totals reflect each user's history within `games/main/answers.json` only

#### Scenario: Mixed correct and incorrect choice answers

- **WHEN** `submit_answers` is called with `game: "main"` and choice answer entries where some are correct and some are incorrect
- **THEN** the result includes per-user entries with `correct`, `totalCorrect`, `totalAnswered`, and `currentStreak`
- **AND** correctness is computed by comparing each entry's `answerIndex` to the question's `correctIndex`

#### Scenario: Equal scoring across question types

- **GIVEN** a user has answered one boolean question correctly and one choice question correctly in the same game
- **WHEN** the user's stats are computed
- **THEN** `totalCorrect` is 2 and `totalAnswered` is 2 (no type-weighted differential)

#### Scenario: Mixed answers, seasons enabled, returns both totals scoped to the game

- **GIVEN** `trivia.seasons.enabled` is `true` and `games/main/seasons.json` has a current entry with slug `"august-2026"`
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

The tool SHALL accept an optional `season` parameter with the following semantics, scoped to the named game's `seasons.json` for resolving `"current"`:

- When `season` is omitted AND seasons are enabled AND `findCurrentSeason` returns a season for the game, the default SHALL be `"current"`.
- When `season` is `"current"`, the tool SHALL filter the game's `answers.json` to entries whose `season` matches the game's currently-active season's slug.
- When `season` is `"all"`, the tool SHALL NOT apply any season filter (groups across the entire game's `answers.json`).
- When `season` is any other string, the tool SHALL filter the game's `answers.json` to entries whose `season` exactly matches the provided value.

When seasons are disabled OR `findCurrentSeason` returns `null` (gap) for the game's timeline, the `season` parameter SHALL be silently ignored and the tool SHALL group across the entire game's `answers.json`.

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
- **AND** no `currentSeasonCorrect` / `currentSeasonAnswered` fields appear on the entries

#### Scenario: displayName falls back to userId when user record missing

- **GIVEN** `games/main/answers.json` contains entries for `U999` and the global `users.json` has no record
- **WHEN** `retrieve_scores` is called with `game: "main"`
- **THEN** the U999 leaderboard entry has `displayName: "U999"`

#### Scenario: Tool is gated to member

- **WHEN** a session's user has role `member` (or higher)
- **THEN** `retrieve_scores` appears in the session's MCP catalog

### Requirement: Pending Free-Form Answer Storage

A `SubmittedAnswer` record SHALL be permitted to omit `correct` (i.e. `correct?: boolean`) and SHALL be permitted to carry an `answerText?: string` field. The combination `correct === undefined` together with a populated `answerText` denotes a pending freeform answer awaiting reveal-time validation. The exactly-one-of discriminator on the answer's content widens from `{ answer | answerIndex }` to `{ answer | answerIndex | answerText }`.

Pending rows SHALL be writable through a freeform modal-submit code path owned by the trivia plugin (not via `submit_answers` — that tool remains the boolean/choice MCP-surface). The existing `submit_answers` tool SHALL continue to write `correct: boolean` synchronously for boolean and choice answers exactly as today; it is not extended to accept freeform answers.

#### Scenario: Pending freeform row written

- **WHEN** the trivia plugin's freeform modal-submit handler writes a `SubmittedAnswer` for `userA` on a freeform question
- **THEN** the persisted row carries `answerText: <text>` and `correct === undefined`
- **AND** does not carry `answer` or `answerIndex`

#### Scenario: Boolean and choice rows unchanged

- **WHEN** `submit_answers` writes a boolean or choice answer row
- **THEN** `correct` is set synchronously at write time as before
- **AND** the row never carries `answerText`

### Requirement: Free-Form Answer Update Op

The trivia plugin's scoped data layer SHALL expose `updateAnswer(rowKey, partial: Partial<SubmittedAnswer>): Promise<void>` that locates a single existing answer row by a stable key and merges the supplied partial into it. The stable key MAY be an explicit `id` field added to `SubmittedAnswer` at write time, or the natural composite `(userId, questionId)` — the choice is captured in the design document; the requirement is that the op resolves a unique row by a stable identifier. When the resolved row does not exist, the op SHALL resolve without error and log a `warn`-level message identifying the unresolved key.

This op exists primarily so that reveal-time freeform judging can flip `correct` from `undefined` to the verdict without rewriting the row.

#### Scenario: Update flips correct from undefined to true

- **WHEN** a pending freeform row exists with `correct === undefined`
- **AND** `updateAnswer` is called with `{ correct: true }` for that row's key
- **THEN** the row is updated in place: `correct: true`, all other fields preserved
- **AND** the answers store contains exactly one row for that key (no duplicate written)

#### Scenario: Update of unresolved key

- **WHEN** `updateAnswer` is called with a key that does not match any row
- **THEN** the call resolves without throwing
- **AND** the answers store is unchanged
- **AND** a `warn`-level log entry is emitted naming the key

### Requirement: Leaderboard and Score Aggregation Exclude Pending Rows

`computeLeaderboard` and any other aggregation over `SubmittedAnswer[]` (e.g. the `retrieve_scores` payload assembly, the per-user stats in `submit_answers`' return shape) SHALL skip rows where `correct === undefined` entirely — they SHALL NOT increment `totalAnswered` and SHALL NOT increment `totalCorrect`. Pending rows SHALL be invisible to the leaderboard until reveal-time judging flips `correct` to a boolean.

#### Scenario: Pending row absent from leaderboard counts

- **GIVEN** the answers store contains one boolean row for `userA` (`correct: true`) and one pending freeform row for `userA` (`correct === undefined`)
- **WHEN** `computeLeaderboard` aggregates
- **THEN** `userA`'s entry shows `totalAnswered: 1, totalCorrect: 1`
- **AND** the pending row contributes nothing to either counter

#### Scenario: Verdict applied row counts normally

- **GIVEN** a previously pending freeform row whose `correct` was flipped to `true` by reveal-time judging
- **WHEN** `computeLeaderboard` re-aggregates
- **THEN** that row now increments both `totalAnswered` and `totalCorrect`
- **AND** behaves identically to a boolean/choice row going forward

### Requirement: Answer History Emits Optional Correct Field

`getQuestionHistory` (and any other reader that exposes per-answer correctness back to Claude or to a renderer) SHALL emit `correct?: boolean` rather than `correct: boolean`. The schema SHALL document that absence indicates "pending reveal-time judging." Callers that count `correct === true` already exclude undefined implicitly; the schema change makes the contract explicit so Claude does not misread a missing field as a false answer.

#### Scenario: History entry for a pending row

- **WHEN** `getQuestionHistory` is called and the answers store contains a pending freeform row
- **THEN** the returned answer entry carries `answerText` and omits `correct`
- **AND** the tool schema documents this case

#### Scenario: History entry for a scored row

- **WHEN** `getQuestionHistory` is called for a question whose answers have all been scored
- **THEN** every returned entry carries `correct: boolean`
- **AND** behavior is identical to today's history output
