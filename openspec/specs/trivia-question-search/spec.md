# Trivia Question Search

## Purpose

Question creation and discovery for trivia questions, including validation, search, and storage. All operations are scoped per-game: every tool takes a required `game: string` argument validated against `config.trivia.games[]`, and reads/writes target `data/plugins/trivia/games/<name>/`.

## Requirements

### Requirement: Find previous questions tool

The system SHALL provide a `find_previous_questions` MCP tool (member role) that searches past trivia questions by category and/or statement text within a specified game.

The tool SHALL accept a required `game: string` argument. The name SHALL be validated against `config.trivia.games[]` per the `trivia-games` capability:
- Unknown name → structured "unknown game" error.
- `enabled: false` entry → success (read tools succeed against disabled games — frozen-archive semantics).

All search I/O SHALL be scoped to `data/plugins/trivia/games/<name>/questions.json`. Cross-game search is not supported.

The tool SHALL accept an optional `season` parameter (string, optional):

- When `season` is omitted, the default SHALL be `"all"` — the tool searches across every entry in the game's `questions.json` regardless of any `season` tag. This default ensures duplicate detection naturally spans the game's seasons.
- When `season` is `"current"`, the tool SHALL filter the game's `questions.json` to entries whose `season` matches the game's currently-active season's slug (resolved via `findCurrentSeason` against `data/plugins/trivia/games/<name>/seasons.json`). If `findCurrentSeason` returns `null` (gap), `"current"` resolves to no matches.
- When `season` is any other string, the tool SHALL filter to entries whose `season` exactly matches the provided value.

When `trivia.seasons.enabled` is `false`, the `season` parameter SHALL be silently ignored and the tool SHALL search across the entire game's `questions.json`.

The tool SHALL accept an optional `recentBatchFromNow: number` parameter (positive integer, 1-indexed) that selects a single batch of posted questions, ranked by recency anchored to the current moment. `1` SHALL mean the batch with the most recent `postedAt` as of now; `2` SHALL mean the batch before that; and so on. The argument name and the tool's description SHALL both make the "as of now" framing explicit so that callers do not interpret it as an absolute index or a season-relative position.

When `recentBatchFromNow` is provided, the tool SHALL:

1. Apply all other filters (`category`, `text`, `season`) to the per-question pool first.
2. From the filtered pool, exclude any question whose `postedAt` is undefined OR whose `batchId` is undefined (legacy unbatched rows are not real batches and SHALL NOT participate in the recency ranking).
3. Group the surviving questions by `batchId`.
4. Sort the groups by `max(postedAt)` descending; ties broken by `batchId` ascending.
5. Select the Nth group (1-indexed). If `N` exceeds the number of available groups, return an empty result.
6. Return every question in the selected group, sorted by `postedAt` ascending, capped at `limit` if provided.

When `recentBatchFromNow <= 0` or is not a positive integer, the tool SHALL return a validation error (enforced by the Zod schema).

#### Scenario: Search by category within a game

- **WHEN** `find_previous_questions` is called with `game: "main", category: "Marine Biology"`
- **THEN** the tool returns all questions in `games/main/questions.json` whose `category` matches "Marine Biology"

#### Scenario: Search by text within a game

- **WHEN** `find_previous_questions` is called with `game: "main", text: "shrimp"`
- **THEN** the tool returns all questions in `games/main/questions.json` whose `statement` contains "shrimp" (case-insensitive)

#### Scenario: Search by both category and text

- **WHEN** `find_previous_questions` is called with `game: "main", category: "Marine Biology", text: "hearts"`
- **THEN** the tool returns questions in `games/main/questions.json` matching both criteria (AND)

#### Scenario: No matches found

- **WHEN** `find_previous_questions` is called with criteria that match no questions in the named game
- **THEN** the tool returns an empty result set

#### Scenario: Game scoping prevents cross-game matches

- **GIVEN** a question with text "Mount Everest is..." exists in `games/main/questions.json`
- **AND** no such question exists in `games/sandbox/questions.json`
- **WHEN** `find_previous_questions` is called with `game: "sandbox", text: "Everest"`
- **THEN** the result is empty

#### Scenario: Unknown game rejected

- **WHEN** `find_previous_questions` is called with `game: "ghost"` (not in `config.trivia.games[]`)
- **THEN** the tool returns a structured "unknown game" error

#### Scenario: Disabled game allows search (frozen archive)

- **GIVEN** `config.trivia.games[]` contains `{ name: "retired", enabled: false, ... }`
- **WHEN** `find_previous_questions` is called with `game: "retired", text: "..."`
- **THEN** the tool succeeds and returns matching historical entries

#### Scenario: Default season is "all" — duplicate detection spans seasons within the game

- **GIVEN** `trivia.seasons.enabled` is `true` with seasons `"spring-2026"` (history) and `"summer-2026"` (current) in `games/main/seasons.json`
- **AND** a question tagged `season: "spring-2026"` exists in `games/main/questions.json`
- **WHEN** `find_previous_questions` is called with `game: "main", text: "..."` and no `season` argument
- **THEN** the spring-2026 question is included in the result set

#### Scenario: Explicit season filter scopes the search

- **WHEN** `find_previous_questions` is called with `game: "main", text: "...", season: "summer-2026"`
- **THEN** only entries tagged `"summer-2026"` are eligible for matching

#### Scenario: Seasons disabled — season parameter ignored

- **GIVEN** `trivia.seasons.enabled` is `false`
- **WHEN** `find_previous_questions` is called with `game: "main", season: "anything"`
- **THEN** the search proceeds across the entire `games/main/questions.json` without any season filter

#### Scenario: "current" during a gap returns empty

- **GIVEN** `findCurrentSeason(games/main/seasons.json, now)` returns `null`
- **WHEN** `find_previous_questions` is called with `game: "main", season: "current"`
- **THEN** the result is empty

#### Scenario: recentBatchFromNow=1 returns the most recent batch in full

- **GIVEN** `games/main/questions.json` contains three batches with distinct `batchId` values, posted at T1 < T2 < T3
- **WHEN** `find_previous_questions` is called with `game: "main", recentBatchFromNow: 1`
- **THEN** the result contains every question whose `batchId` matches the T3 batch
- **AND** the questions are ordered by `postedAt` ascending
- **AND** no question from the T1 or T2 batches appears

#### Scenario: recentBatchFromNow=2 returns the second-most-recent batch

- **GIVEN** the same three-batch setup
- **WHEN** `find_previous_questions` is called with `game: "main", recentBatchFromNow: 2`
- **THEN** the result contains exactly the T2 batch's questions

#### Scenario: recentBatchFromNow exceeds available batches

- **GIVEN** `games/main/questions.json` contains exactly two distinct batches
- **WHEN** `find_previous_questions` is called with `game: "main", recentBatchFromNow: 5`
- **THEN** the result is empty
- **AND** the response is not an error

#### Scenario: Legacy rows without batchId are excluded from the recent-batch view

- **GIVEN** `games/main/questions.json` contains one batched question (batchId set, postedAt = T2) and one legacy posted question (no batchId, postedAt = T3, more recent)
- **WHEN** `find_previous_questions` is called with `game: "main", recentBatchFromNow: 1`
- **THEN** the result contains the batched question only
- **AND** the legacy row does not appear, even though its `postedAt` is more recent

#### Scenario: Filters compose with recentBatchFromNow before grouping

- **GIVEN** the most recent batch (T3) contains questions in categories `["X", "Y"]` and the second-most-recent batch (T2) contains questions in category `["X"]`
- **WHEN** `find_previous_questions` is called with `game: "main", category: "Y", recentBatchFromNow: 1`
- **THEN** the result contains the T3 batch's category-Y questions only (the most recent batch that still has matches after the category filter)

#### Scenario: Filters can eliminate a batch from the ranking

- **GIVEN** the most recent batch (T3) contains only category `"X"` questions, the second batch (T2) contains only category `"Y"` questions
- **WHEN** `find_previous_questions` is called with `game: "main", category: "Y", recentBatchFromNow: 1`
- **THEN** the result is the T2 batch's questions (T3 was filtered out by the category constraint before ranking)

#### Scenario: recentBatchFromNow=0 is rejected

- **WHEN** `find_previous_questions` is called with `game: "main", recentBatchFromNow: 0`
- **THEN** the tool returns a validation error indicating `recentBatchFromNow` must be a positive integer

#### Scenario: Negative recentBatchFromNow is rejected

- **WHEN** `find_previous_questions` is called with `game: "main", recentBatchFromNow: -1`
- **THEN** the tool returns a validation error

### Requirement: save_question replaces generate_question

The system SHALL provide a `save_question` MCP tool (member role) that saves a new trivia question to a specified game.

The tool SHALL accept a required `game: string` argument. The name SHALL be validated against `config.trivia.games[]` per the `trivia-games` capability:
- Unknown name → structured "unknown game" error.
- `enabled: false` entry → structured "game is disabled" error (write tool).

The new question SHALL be appended to `data/plugins/trivia/games/<name>/questions.json` — never to a flat-file `questions.json` at the trivia root, and never to another game's file.

The tool SHALL accept the following discriminated argument shapes determined by the `answersFormat` field:

**Boolean shape** (`answersFormat: "boolean"`): `category`, `statement`, `isTrue`, `emojis`, and (per `trivia-topical-questions`) a required `questionType: "fact" | "topical"`. The stored record carries `answersFormat: "boolean"`, `questionType`, and `isTrue`, and does NOT carry `choices` or `correctIndex`.

**Choice shape** (`answersFormat: "choice"`): `category`, `statement`, `emojis`, `choices: string[]` (length within active `[min, max]` bounds from `trivia.choices`, default `[2, 4]`), `correctIndex: number` (integer in `[0, choices.length)`), and `questionType: "fact" | "topical"`. The stored record carries `answersFormat: "choice"`, `questionType`, `choices`, and `correctIndex`, and does NOT carry `isTrue`.

In both shapes, the tool SHALL additionally accept (per `trivia-topical-questions` and `trivia-question-contexts`):

- `sourceUrl?: string` — required when `questionType: "topical"`, forbidden when `questionType: "fact"`. Must be `https://`-prefixed.
- `eventDate?: string` — optional ISO 8601 calendar date (`YYYY-MM-DD`); permitted only when `questionType: "topical"`.
- `context?: string` — optional lens name. When non-empty, must appear in the active `contexts` resolved for this question's slot/season/config; when empty or absent, the persisted record omits the `context` field. When `contexts` is not configured at any cascade tier, a non-empty `context` argument is rejected.

The tool SHALL validate (in addition to the existing statement-length checks):

- `answersFormat` MUST be `"boolean"` or `"choice"` (required field).
- `questionType` MUST be `"fact"` or `"topical"` (required field).
- For the choice shape: `choices.length` is within the active `[min, max]` bounds, `correctIndex` is an integer in `[0, choices.length)`, every choice string is 1–100 characters after trimming, and `new Set(choices.map(c => c.trim().toLowerCase())).size === choices.length` (no duplicate or whitespace/case-equivalent choice strings).
- For the choice shape: `isTrue` is not provided.
- For the boolean shape: `choices` and `correctIndex` are not provided.
- `sourceUrl` / `eventDate` / `context` rules as listed above.

On validation failure, the tool SHALL return a structured error indicating which constraint failed.

When `trivia.seasons.enabled` is `true` AND `findCurrentSeason(games/<name>/seasons.json, now)` returns a season, each new entry written to the game's `questions.json` SHALL include a `season: string` field equal to that season's slug. When seasons are disabled OR `findCurrentSeason` returns `null` (gap) for the game's timeline, no `season` field is written.

Category validation reads from the game's currently-active season's `categories` when seasons are enabled with a current season; otherwise from the global `categories.json` at the trivia root.

#### Scenario: Save a valid fact boolean question

- **WHEN** `save_question` is called with `game: "main"`, `answersFormat: "boolean"`, `questionType: "fact"`, a valid category, statement, `isTrue`, and emojis
- **THEN** the question is appended to `games/main/questions.json` with `answersFormat: "boolean"`, `questionType: "fact"`, the provided fields, plus a generated ID and `createdAt` timestamp
- **AND** the record carries no `sourceUrl` or `eventDate` field

#### Scenario: Save a valid fact choice question

- **WHEN** `save_question` is called with `game: "main"`, `answersFormat: "choice"`, `questionType: "fact"`, a valid category, statement, emojis, `choices` of length 4, and `correctIndex: 2`
- **THEN** the question is appended to `games/main/questions.json` with `answersFormat: "choice"`, `questionType: "fact"`, the provided choices and correctIndex, plus a generated ID and `createdAt` timestamp

#### Scenario: Save a valid topical choice question

- **WHEN** `save_question` is called with `game: "main"`, `answersFormat: "choice"`, `questionType: "topical"`, valid category/statement/emojis/choices/correctIndex, `sourceUrl: "https://example.com/article"`, and `eventDate: "2026-05-19"`
- **THEN** the question is appended to `games/main/questions.json` with all fields, including `sourceUrl` and `eventDate`

#### Scenario: answersFormat field is required

- **WHEN** `save_question` is called without an `answersFormat` field
- **THEN** the tool returns a validation error indicating `answersFormat` is required

#### Scenario: questionType field is required

- **WHEN** `save_question` is called with `answersFormat: "boolean"` but no `questionType` field
- **THEN** the tool returns a validation error indicating `questionType` is required

#### Scenario: Statement too short

- **WHEN** `save_question` is called with `game: "main"` and a statement shorter than 10 characters
- **THEN** the tool returns a validation error

#### Scenario: Statement too long

- **WHEN** `save_question` is called with `game: "main"` and a statement longer than 500 characters
- **THEN** the tool returns a validation error

#### Scenario: Choice question with correctIndex out of range

- **WHEN** `save_question` is called with `game: "main"`, `answersFormat: "choice"`, `choices` of length 4, and `correctIndex: 4`
- **THEN** the tool returns a validation error indicating `correctIndex` must be in `[0, choices.length)`

#### Scenario: Choice question with duplicate choices

- **WHEN** `save_question` is called with `game: "main"`, `answersFormat: "choice"`, and `choices: ["Paris", "London", "Paris", "Rome"]`
- **THEN** the tool returns a validation error indicating choices must be unique

#### Scenario: Choice question outside configured bounds

- **GIVEN** active `trivia.choices` bounds of `min: 2, max: 4`
- **WHEN** `save_question` is called with `game: "main"`, `answersFormat: "choice"`, and `choices` of length 5
- **THEN** the tool returns a validation error indicating choices length is outside the bounds

#### Scenario: Choice question with isTrue rejected

- **WHEN** `save_question` is called with `game: "main"`, `answersFormat: "choice"`, AND `isTrue: true`
- **THEN** the tool returns a validation error indicating `isTrue` is invalid for choice questions

#### Scenario: Boolean question with choices rejected

- **WHEN** `save_question` is called with `game: "main"`, `answersFormat: "boolean"`, AND `choices: ["A", "B"]`
- **THEN** the tool returns a validation error indicating `choices` is invalid for boolean questions

#### Scenario: Unknown game rejected

- **WHEN** `save_question` is called with `game: "ghost"`
- **THEN** the tool returns a structured "unknown game" error
- **AND** no file is created or modified

#### Scenario: Disabled game refuses the write

- **GIVEN** `config.trivia.games[]` contains `{ name: "retired", enabled: false, ... }`
- **WHEN** `save_question` is called with `game: "retired"` and otherwise-valid args
- **THEN** the tool returns a structured "game is disabled" error
- **AND** `data/plugins/trivia/games/retired/questions.json` is unchanged

#### Scenario: New question carries the current season tag

- **GIVEN** `trivia.seasons.enabled` is `true` and `games/main/seasons.json` has a current entry with slug `"august-2026"`
- **WHEN** `save_question` is called with `game: "main"` and valid arguments
- **THEN** the new entry in `games/main/questions.json` includes `season: "august-2026"`

#### Scenario: New question carries no season tag when seasons are disabled

- **GIVEN** `trivia.seasons.enabled` is `false`
- **WHEN** `save_question` is called with `game: "main"` and valid arguments
- **THEN** the new entry in `games/main/questions.json` contains no `season` field

### Requirement: Find previous questions response excludes the answer key

The `find_previous_questions` MCP tool SHALL NOT include the question's answer-key fields (`isTrue` for boolean questions, `correctIndex` for choice questions) in any element of its returned `questions` array, regardless of caller role. The tool SHALL return only search-safe metadata: `id`, `answersFormat`, `questionType`, `category`, `statement`, `emojis`, `createdAt`, and (when present on the stored record) `postedAt`, `messageLink`, `context`, `sourceUrl`, and `eventDate`. For choice questions, the tool SHALL include the `choices` array (the choice strings themselves are not the answer key — the answer key is the `correctIndex`).

This requirement closes a pre-existing exposure where any session at the `member` tier could prompt Clack into surfacing the canonical answer key for past questions through the search tool. The tool's gating remains `member`; the response shape is what changes. This requirement is unaffected by the `game` argument — the answer-key exclusion applies to every game's results.

#### Scenario: Boolean response payload omits isTrue

- **WHEN** `find_previous_questions` is invoked with any combination of valid arguments (including `game`) and matches at least one stored boolean question
- **THEN** every boolean element of the returned `questions` array contains `id`, `answersFormat`, `questionType`, `category`, `statement`, `emojis`, `createdAt`, and (when present on the stored record) `postedAt`, `messageLink`, `context`, `sourceUrl`, `eventDate`
- **AND** no element contains an `isTrue` field

#### Scenario: Choice response payload omits correctIndex but includes choices

- **WHEN** `find_previous_questions` is invoked and matches at least one stored choice question
- **THEN** every choice element of the returned `questions` array contains `id`, `answersFormat: "choice"`, `questionType`, `category`, `statement`, `emojis`, `choices`, `createdAt`, and (when present on the stored record) `postedAt`, `messageLink`, `context`, `sourceUrl`, `eventDate`
- **AND** no element contains a `correctIndex` field
- **AND** no element contains an `isTrue` field

#### Scenario: Empty result is unaffected

- **WHEN** `find_previous_questions` is invoked with criteria that match no questions in the named game
- **THEN** the tool returns an empty `questions` array
- **AND** no answer-key data is returned in any other field of the response

### Requirement: Get question history tool

The Trivia plugin SHALL expose a `get_question_history` MCP tool that returns the answer key, the list of users caught cheating on the question, and the list of submitted answers, for a single question identified by `questionId` within a specified game.

The tool SHALL be gated to the `admin` role. The tool SHALL accept the following arguments:

- `game` (string, required) — the game slug; validated against `config.trivia.games[]` per the `trivia-games` capability. Read tool — succeeds against `enabled: false` games.
- `questionId` (string, required) — the ID of the trivia question to look up within the named game.

The tool SHALL look up the question only in `data/plugins/trivia/games/<game>/questions.json`, the cheat list only in `data/plugins/trivia/games/<game>/cheats.json`, and the answers only in `data/plugins/trivia/games/<game>/answers.json`. The `displayName` SHALL be looked up from the global `data/plugins/trivia/users.json`.

The tool SHALL return the question's answer key in an answersFormat-discriminated shape:

- For boolean questions: `answersFormat: "boolean"`, `questionType: "fact" | "topical"`, and `isTrue: boolean`.
- For choice questions: `answersFormat: "choice"`, `questionType: "fact" | "topical"`, `choices: string[]`, and `correctIndex: number`.

When the resolved question record carries `context`, `sourceUrl`, or `eventDate`, the tool SHALL include those fields in the response payload.

The tool SHALL also return:

- `cheaterUserIds` (string array) — the deduplicated list of `cheaterUserId` values from every entry in the named game's `cheats.json` whose `questionId` matches the requested question.
- `responses` (array of objects) — every entry from the named game's `answers.json` whose `questionId` matches, projected to `{ userId, displayName, answer?, answerIndex?, correct }`. The `displayName` SHALL be looked up from the global `users.json`; when no user record exists, `displayName` SHALL fall back to `userId`. Each response entry carries `answer` for boolean-question answers and `answerIndex` for choice-question answers, mirroring the stored row's shape.

The tool's description SHALL instruct Claude that cheater identities are internal — Claude MUST NOT name caught cheaters in any user-facing output unless an admin explicitly asks for the list.

#### Scenario: Returns boolean answer key, cheaters, and responses scoped to the game

- **WHEN** `get_question_history` is called with `game: "main"` and a `questionId` for a boolean question in that game
- **THEN** the response includes `answersFormat: "boolean"`, `questionType`, `isTrue`, plus the `cheaterUserIds` and `responses` arrays scoped to that game

#### Scenario: Returns choice answer key, cheaters, and responses

- **WHEN** `get_question_history` is called for a choice question
- **THEN** the response includes `answersFormat: "choice"`, `questionType`, `choices`, `correctIndex`, plus `cheaterUserIds` and `responses` arrays

#### Scenario: Topical question history includes sourceUrl

- **WHEN** `get_question_history` is called for a topical question with a stored `sourceUrl`
- **THEN** the response includes `sourceUrl` and (when present) `eventDate`

#### Scenario: Question with context surfaces the context value

- **WHEN** `get_question_history` is called for a question whose record carries `context: "Quebec"`
- **THEN** the response includes `context: "Quebec"`
