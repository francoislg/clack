## MODIFIED Requirements

### Requirement: Find previous questions tool

The system SHALL provide a `find_previous_questions` MCP tool (member role) that searches past trivia questions by combining one or more array-shaped criteria with a top-level boolean combinator.

#### Top-level criteria

The tool SHALL accept the following array-shaped filter criteria. Within any single array, semantics are always OR — a row matches the criterion if ANY entry hits. An omitted array, or an empty array, SHALL be treated as "criterion not supplied" and SHALL NOT participate in the cross-criterion combinator.

- `games?: string[]` — each entry SHALL be validated against `config.trivia.games[]` per the `trivia-games` capability. Unknown entry → structured "unknown game" error citing the offending name. Disabled entries are permitted (read tool — frozen-archive semantics). When `games` is omitted or empty, the tool SHALL read `questions.json` from every game registered in `config.trivia.games[]`, skipping any whose file is absent on disk.
- `categories?: string[]` — case-insensitive exact match against the row's `category`. Row matches if its `category` equals any entry (case-insensitive).
- `seasons?: string[]` — each entry is either a season slug or the literal `"current"`. Row matches if its `season` equals any resolved entry. `"current"` SHALL be resolved per-game via `findCurrentSeason` against that game's `seasons.json`; if a game's `findCurrentSeason` returns `null`, `"current"` contributes no match for rows in that game. When `trivia.seasons.enabled` is `false`, the `seasons` argument SHALL be silently ignored and SHALL NOT participate in the combinator.
- `keywords?: string[]` — each entry is lowercased; the row matches if its lowercased `statement` includes any entry as a substring.

#### Top-level combinator

The tool SHALL accept an optional `match: "any" | "all"` argument, defaulting to `"all"`. The combinator governs how supplied criteria combine across the top level — it does NOT alter the within-array OR semantics of any single criterion.

- `match: "all"` — a row matches the filter iff every supplied criterion is true for the row.
- `match: "any"` — a row matches the filter iff at least one supplied criterion is true for the row.

When NO criteria are supplied (every array criterion is omitted or empty), the tool SHALL return every question in scope (matching `recentBatchFromNow` and `limit` behavior as defined below). The combinator value is irrelevant in this case.

#### Per-row response

Each returned question SHALL carry, in addition to the safety-preserved fields enumerated in the `Find previous questions response excludes the answer key` requirement, the following:

- `game: string` — the game the row came from. Present on every row regardless of whether the call was cross-game or single-game.
- `matchedKeywords?: string[]` — present iff the call supplied a non-empty `keywords` array. Each entry SHALL be a member of the input `keywords` whose lowercased form is a substring of the row's lowercased `statement`. Order SHALL preserve the input `keywords` order. The field SHALL be absent when `keywords` was omitted or empty.

#### Sort and limit

When `recentBatchFromNow` is not provided, results SHALL be sorted by `createdAt` descending and capped at `limit` (default 20).

#### Recent batch view

The tool SHALL accept an optional `recentBatchFromNow: number` parameter (positive integer, 1-indexed) that selects a single batch of posted questions, ranked by recency anchored to the current moment. `1` SHALL mean the batch with the most recent `postedAt` as of now; `2` SHALL mean the batch before that; and so on. The argument name and the tool's description SHALL both make the "as of now" framing explicit so that callers do not interpret it as an absolute index or a season-relative position.

When `recentBatchFromNow` is present, the tool SHALL require `games.length === 1`. If `games` is omitted/empty OR contains more than one entry, the tool SHALL return a validation error indicating `recentBatchFromNow` requires exactly one game. This restriction exists because `batchId`s are minted per `post_questions` call within a game and are not unique across games; cross-game batch ranking is semantically incoherent.

When `recentBatchFromNow` is provided with a valid single-game `games` argument, the tool SHALL:

1. Apply all other criteria (`categories`, `seasons`, `keywords`) under the active `match` combinator to the per-question pool first.
2. From the filtered pool, exclude any question whose `postedAt` is undefined OR whose `batchId` is undefined (legacy unbatched rows are not real batches and SHALL NOT participate in the recency ranking).
3. Group the surviving questions by `batchId`.
4. Sort the groups by `max(postedAt)` descending; ties broken by `batchId` ascending.
5. Select the Nth group (1-indexed). If `N` exceeds the number of available groups, return an empty result.
6. Return every question in the selected group, sorted by `postedAt` ascending, capped at `limit` if provided.

When `recentBatchFromNow <= 0` or is not a positive integer, the tool SHALL return a validation error (enforced by the Zod schema).

#### Scenario: Cross-game scan when `games` is omitted

- **GIVEN** `config.trivia.games[]` contains `"main"` and `"sandbox"`, each with a `questions.json` containing a question whose `statement` includes "shrimp"
- **WHEN** `find_previous_questions` is called with `keywords: ["shrimp"]` and no `games` argument
- **THEN** the result contains both the main and sandbox questions
- **AND** each returned row carries a `game` field naming its origin

#### Scenario: Single-game scoping via `games: ["main"]`

- **WHEN** `find_previous_questions` is called with `games: ["main"], keywords: ["shrimp"]`
- **THEN** only `main` questions are scanned
- **AND** every returned row carries `game: "main"`

#### Scenario: Multi-game scoping via `games: ["main", "sandbox"]`

- **WHEN** `find_previous_questions` is called with `games: ["main", "sandbox"], keywords: ["shrimp"]`
- **THEN** rows from `main` and `sandbox` are eligible; rows from other registered games are excluded
- **AND** each returned row's `game` field names `main` or `sandbox`

#### Scenario: Unknown game in `games` rejected

- **WHEN** `find_previous_questions` is called with `games: ["main", "ghost"]` and `"ghost"` is not in `config.trivia.games[]`
- **THEN** the tool returns a structured "unknown game" error citing `"ghost"`
- **AND** no scan is performed

#### Scenario: Disabled game allows cross-game search (frozen archive)

- **GIVEN** `config.trivia.games[]` contains `{ name: "retired", enabled: false, ... }`
- **WHEN** `find_previous_questions` is called with no `games` argument
- **THEN** the scan includes `retired`'s `questions.json` and may return matching rows
- **AND** each returned row from `retired` carries `game: "retired"`

#### Scenario: Keywords OR-internal — any keyword hits

- **WHEN** `find_previous_questions` is called with `keywords: ["mozart", "beethoven"]`
- **THEN** rows whose `statement` contains either "mozart" OR "beethoven" (case-insensitive) are returned
- **AND** rows containing both are returned once, not twice

#### Scenario: matchedKeywords reflects which keywords hit each row

- **GIVEN** a question with `statement: "Mozart composed The Magic Flute in 1791."`
- **WHEN** `find_previous_questions` is called with `keywords: ["mozart", "beethoven", "1791"]`
- **THEN** the returned row carries `matchedKeywords: ["mozart", "1791"]` (preserving input order; "beethoven" omitted)

#### Scenario: matchedKeywords absent when keywords not supplied

- **WHEN** `find_previous_questions` is called with `categories: ["Music"]` and no `keywords`
- **THEN** no returned row carries a `matchedKeywords` field

#### Scenario: Default match is "all" — every supplied criterion must hit

- **WHEN** `find_previous_questions` is called with `keywords: ["mozart"], categories: ["Music"]` and `match` is omitted
- **THEN** only rows whose `statement` contains "mozart" AND whose `category` equals "Music" (case-insensitive) are returned

#### Scenario: match: "any" — at least one supplied criterion must hit

- **WHEN** `find_previous_questions` is called with `keywords: ["mozart"], categories: ["Music"], match: "any"`
- **THEN** the returned set is the union of (rows mentioning "mozart") and (rows in "Music")
- **AND** rows matching both are returned once, not twice

#### Scenario: match: "all" with only one criterion supplied

- **WHEN** `find_previous_questions` is called with `keywords: ["mozart"], match: "all"` (no other criteria)
- **THEN** the result is identical to calling with `keywords: ["mozart"], match: "any"`
- **AND** the result contains rows whose `statement` contains "mozart"

#### Scenario: No criteria supplied returns everything in scope

- **WHEN** `find_previous_questions` is called with no `games`, `categories`, `seasons`, or `keywords`
- **THEN** the scan visits every game's `questions.json`
- **AND** every row in every game is returned, sorted by `createdAt` descending, capped at `limit`

#### Scenario: Empty arrays equal omitted arrays

- **WHEN** `find_previous_questions` is called with `games: [], categories: [], seasons: [], keywords: ["mozart"]`
- **THEN** the result is identical to calling with `keywords: ["mozart"]` and no other criteria
- **AND** the empty arrays do NOT cause "no match" — they are ignored

#### Scenario: Seasons "current" resolves per-game

- **GIVEN** `trivia.seasons.enabled` is `true`
- **AND** game `"main"` has `findCurrentSeason → { slug: "summer-2026", ... }`
- **AND** game `"sandbox"` has `findCurrentSeason → { slug: "demo-2026", ... }`
- **WHEN** `find_previous_questions` is called with `seasons: ["current"]` and no `games`
- **THEN** rows from `main` match iff their `season` equals "summer-2026"
- **AND** rows from `sandbox` match iff their `season` equals "demo-2026"

#### Scenario: Seasons "current" during a gap contributes no match for that game

- **GIVEN** `trivia.seasons.enabled` is `true` and `findCurrentSeason` returns `null` for game `"main"`
- **WHEN** `find_previous_questions` is called with `games: ["main"], seasons: ["current"]`
- **THEN** the result is empty

#### Scenario: Multiple season slugs OR-internal

- **WHEN** `find_previous_questions` is called with `seasons: ["spring-2026", "summer-2026"]`
- **THEN** rows tagged with either season are returned

#### Scenario: Seasons disabled — seasons argument ignored

- **GIVEN** `trivia.seasons.enabled` is `false`
- **WHEN** `find_previous_questions` is called with `seasons: ["anything"], keywords: ["mozart"]`
- **THEN** the seasons argument is ignored and only the keywords criterion governs matching

#### Scenario: recentBatchFromNow requires exactly one game

- **WHEN** `find_previous_questions` is called with `recentBatchFromNow: 1` and no `games`
- **THEN** the tool returns a validation error indicating `recentBatchFromNow` requires exactly one game

#### Scenario: recentBatchFromNow rejects multi-game

- **WHEN** `find_previous_questions` is called with `recentBatchFromNow: 1, games: ["main", "sandbox"]`
- **THEN** the tool returns a validation error indicating `recentBatchFromNow` requires exactly one game

#### Scenario: recentBatchFromNow=1 with single game returns the most recent batch

- **GIVEN** `games/main/questions.json` contains three batches with distinct `batchId` values, posted at T1 < T2 < T3
- **WHEN** `find_previous_questions` is called with `games: ["main"], recentBatchFromNow: 1`
- **THEN** the result contains every question whose `batchId` matches the T3 batch
- **AND** the questions are ordered by `postedAt` ascending
- **AND** every returned row carries `game: "main"`

#### Scenario: recentBatchFromNow=2 returns the second-most-recent batch

- **GIVEN** the same three-batch setup
- **WHEN** `find_previous_questions` is called with `games: ["main"], recentBatchFromNow: 2`
- **THEN** the result contains exactly the T2 batch's questions

#### Scenario: recentBatchFromNow exceeds available batches

- **GIVEN** `games/main/questions.json` contains exactly two distinct batches
- **WHEN** `find_previous_questions` is called with `games: ["main"], recentBatchFromNow: 5`
- **THEN** the result is empty
- **AND** the response is not an error

#### Scenario: Legacy rows without batchId are excluded from the recent-batch view

- **GIVEN** `games/main/questions.json` contains one batched question (batchId set, postedAt = T2) and one legacy posted question (no batchId, postedAt = T3, more recent)
- **WHEN** `find_previous_questions` is called with `games: ["main"], recentBatchFromNow: 1`
- **THEN** the result contains the batched question only
- **AND** the legacy row does not appear, even though its `postedAt` is more recent

#### Scenario: Filters compose with recentBatchFromNow before grouping

- **GIVEN** the most recent batch (T3) contains questions in categories `["X", "Y"]` and the second-most-recent batch (T2) contains questions in category `["X"]`
- **WHEN** `find_previous_questions` is called with `games: ["main"], categories: ["Y"], recentBatchFromNow: 1`
- **THEN** the result contains the T3 batch's category-Y questions only

#### Scenario: Filters can eliminate a batch from the ranking

- **GIVEN** the most recent batch (T3) contains only category `"X"` questions, the second batch (T2) contains only category `"Y"` questions
- **WHEN** `find_previous_questions` is called with `games: ["main"], categories: ["Y"], recentBatchFromNow: 1`
- **THEN** the result is the T2 batch's questions (T3 was filtered out by the category constraint before ranking)

#### Scenario: recentBatchFromNow=0 is rejected

- **WHEN** `find_previous_questions` is called with `games: ["main"], recentBatchFromNow: 0`
- **THEN** the tool returns a validation error indicating `recentBatchFromNow` must be a positive integer

#### Scenario: Negative recentBatchFromNow is rejected

- **WHEN** `find_previous_questions` is called with `games: ["main"], recentBatchFromNow: -1`
- **THEN** the tool returns a validation error

### Requirement: Find previous questions response excludes the answer key

The `find_previous_questions` MCP tool SHALL NOT include the question's answer-key fields (`isTrue` for boolean questions, `correctIndex` for choice questions, `expectedAnswer` / `acceptableAnswers` / `gradingNotes` for freeform questions) in any element of its returned `questions` array, regardless of caller role. The tool SHALL return only search-safe metadata: `id`, `game`, `answersFormat`, `questionType`, `category`, `statement`, `emojis`, `createdAt`, and (when present on the stored record) `postedAt`, `messageLink`, `context`, `sourceUrl`, `eventDate`, `season`, and (when `keywords` was supplied) `matchedKeywords`. For choice questions, the tool SHALL include the `choices` array (the choice strings themselves are not the answer key — the answer key is the `correctIndex`).

This requirement closes a pre-existing exposure where any session at the `member` tier could prompt Clack into surfacing the canonical answer key for past questions through the search tool. The tool's gating remains `member`; the response shape is what changes. This requirement is unaffected by which games are in scope — the answer-key exclusion applies to every row, in every game.

#### Scenario: Boolean response payload omits isTrue

- **WHEN** `find_previous_questions` is invoked with any combination of valid arguments and matches at least one stored boolean question
- **THEN** every boolean element of the returned `questions` array contains `id`, `game`, `answersFormat`, `questionType`, `category`, `statement`, `emojis`, `createdAt`, and (when present on the stored record) `postedAt`, `messageLink`, `context`, `sourceUrl`, `eventDate`, `season`
- **AND** no element contains an `isTrue` field

#### Scenario: Choice response payload omits correctIndex but includes choices

- **WHEN** `find_previous_questions` is invoked and matches at least one stored choice question
- **THEN** every choice element of the returned `questions` array contains `id`, `game`, `answersFormat: "choice"`, `questionType`, `category`, `statement`, `emojis`, `choices`, `createdAt`, and (when present on the stored record) `postedAt`, `messageLink`, `context`, `sourceUrl`, `eventDate`, `season`
- **AND** no element contains a `correctIndex` field
- **AND** no element contains an `isTrue` field

#### Scenario: Freeform response payload omits answer-key fields

- **WHEN** `find_previous_questions` is invoked and matches at least one stored freeform question
- **THEN** every freeform element of the returned `questions` array contains `id`, `game`, `answersFormat: "freeform"`, `questionType`, `category`, `statement`, `emojis`, `createdAt`, and (when present on the stored record) `postedAt`, `messageLink`, `context`, `sourceUrl`, `eventDate`, `season`
- **AND** no element contains an `expectedAnswer`, `acceptableAnswers`, or `gradingNotes` field

#### Scenario: Empty result is unaffected

- **WHEN** `find_previous_questions` is invoked with criteria that match no questions
- **THEN** the tool returns an empty `questions` array
- **AND** no answer-key data is returned in any other field of the response
