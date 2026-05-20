## MODIFIED Requirements

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
