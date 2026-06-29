## MODIFIED Requirements

### Requirement: Find previous questions tool

The system SHALL provide a `find_previous_questions` MCP tool (member role) that searches past trivia questions by combining one or more array-shaped criteria with a top-level boolean combinator.

#### Top-level criteria

The tool SHALL accept the following array-shaped filter criteria. Within any single array, semantics are always OR — a row matches the criterion if ANY entry hits. An omitted array, or an empty array, SHALL be treated as "criterion not supplied" and SHALL NOT participate in the cross-criterion combinator.

- `games?: string[]` — each entry SHALL be validated against `config.trivia.games[]` per the `trivia-games` capability. Unknown entry → structured "unknown game" error citing the offending name. Disabled entries are permitted (read tool — frozen-archive semantics). When `games` is omitted or empty, the tool SHALL read `questions.json` from every game registered in `config.trivia.games[]`, skipping any whose file is absent on disk.
- `categories?: string[]` — case-insensitive exact match against the row's `category`. Row matches if its `category` equals any entry (case-insensitive). This criterion matches ONLY the `category` field; `category` is NOT folded into the keyword search haystack, so duplicate detection that omits `categories` stays cross-category.
- `seasons?: string[]` — each entry is either a season slug or the literal `"current"`. Row matches if its `season` equals any resolved entry. `"current"` SHALL be resolved per-game via `findCurrentSeason` against that game's `seasons.json`; if a game's `findCurrentSeason` returns `null`, `"current"` contributes no match for rows in that game. When `trivia.seasons.enabled` is `false`, the `seasons` argument SHALL be silently ignored and SHALL NOT participate in the combinator.
- `keywords?: string[]` — each entry is lowercased; the row matches if any entry is a substring of any element of the row's **search haystack**. The haystack is the row's lowercased `statement`; plus, when `promptMedium === "image"` and `media` is present, the `media.title` and `media.altText`; plus its answer-type-specific text: for `choice` rows the `choices[]` option strings; for `freeform` rows the `expectedAnswer`, each `acceptableAnswers[]` entry, and `gradingNotes`; `boolean` rows contribute no answer-type-specific text. The answer-type-specific text SHALL be produced by the row's answer-type handler (`keywordHaystack`) rather than by inline `answersFormat` branching in the tool; the format-agnostic base (`statement` and the image `media` text) SHALL be assembled by the tool itself (image `media` text is orthogonal to `answersFormat`). The answer-bearing fields are searched only; they remain governed by the `Find previous questions response excludes the answer key` requirement (a freeform row's answer fields are never returned; a choice row's `choices` continue to be returned because they are not the answer key).
- `posted?: boolean` — a row matches this criterion iff the condition on `postedAt` is satisfied. `posted: true` matches rows with `postedAt !== undefined`; `posted: false` matches rows with `postedAt === undefined`. When omitted, the criterion is not supplied and SHALL NOT participate in the combinator.

#### Top-level combinator

The tool SHALL accept an optional `match: "any" | "all"` argument, defaulting to `"all"`. The combinator governs how supplied criteria combine across the top level — it does NOT alter the within-array OR semantics of any single criterion.

- `match: "all"` — a row matches the filter iff every supplied criterion is true for the row.
- `match: "any"` — a row matches the filter iff at least one supplied criterion is true for the row.

When NO criteria are supplied (every array criterion is omitted or empty), the tool SHALL return every question in scope (matching `recentBatchFromNow` and `limit` behavior as defined below). The combinator value is irrelevant in this case.

#### Per-row response

Each returned question SHALL carry, in addition to the safety-preserved fields enumerated in the `Find previous questions response excludes the answer key` requirement, the following:

- `game: string` — the game the row came from. Present on every row regardless of whether the call was cross-game or single-game.
- `matchedKeywords?: string[]` — present iff the call supplied a non-empty `keywords` array. Each entry SHALL be a member of the input `keywords` whose lowercased form is a substring of ANY element of the row's search haystack (statement plus answer-type-specific text, as defined for the `keywords` criterion). Order SHALL preserve the input `keywords` order. The field SHALL be absent when `keywords` was omitted or empty.

The tool SHALL accept an optional `recentBatchFromNow: number` parameter (positive integer, 1-indexed) that selects a single batch of posted questions, ranked by recency anchored to the current moment. `1` SHALL mean the batch with the most recent `postedAt` as of now; `2` SHALL mean the batch before that; and so on. The argument name and the tool's description SHALL both make the "as of now" framing explicit so that callers do not interpret it as an absolute index or a season-relative position.

When `recentBatchFromNow` is provided, the tool SHALL:

1. Apply all other filters (`category`, `text`, `season`) to the per-question pool first.
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
- **THEN** rows whose haystack contains either "mozart" OR "beethoven" (case-insensitive) are returned
- **AND** rows containing both are returned once, not twice

#### Scenario: matchedKeywords reflects which keywords hit each row

- **GIVEN** a question with `statement: "Mozart composed The Magic Flute in 1791."`
- **WHEN** `find_previous_questions` is called with `keywords: ["mozart", "beethoven", "1791"]`
- **THEN** the returned row carries `matchedKeywords: ["mozart", "1791"]` (preserving input order; "beethoven" omitted)

#### Scenario: matchedKeywords absent when keywords not supplied

- **WHEN** `find_previous_questions` is called with `categories: ["Music"]` and no `keywords`
- **THEN** no returned row carries a `matchedKeywords` field

#### Scenario: Keyword hits a choice option absent from the statement

- **GIVEN** a `choice` question with `statement: "Which country won the 1998 FIFA World Cup?"` and `choices: ["France", "Brazil", "Italy", "Germany"]`
- **WHEN** `find_previous_questions` is called with `keywords: ["brazil"]`
- **THEN** the row is returned even though "brazil" is absent from its `statement` (it matched a choice option)
- **AND** the row carries `matchedKeywords: ["brazil"]`

#### Scenario: Keyword hits a freeform answer field absent from the statement

- **GIVEN** a `freeform` question with `statement: "Name the painter of the Mona Lisa."` and `expectedAnswer: "Leonardo da Vinci"`
- **WHEN** `find_previous_questions` is called with `keywords: ["leonardo"]`
- **THEN** the row is returned even though "leonardo" is absent from its `statement` (it matched the `expectedAnswer`)
- **AND** the row carries `matchedKeywords: ["leonardo"]`
- **AND** the returned row does NOT carry `expectedAnswer`, `acceptableAnswers`, or `gradingNotes` (the answer fields are searched, never returned)

#### Scenario: Boolean rows match only on their statement

- **GIVEN** a `boolean` question with `statement: "The Great Wall of China is visible from space."`
- **WHEN** `find_previous_questions` is called with `keywords: ["space"]`
- **THEN** the row is returned, matched via its `statement`
- **AND** the boolean handler contributes no answer-bearing text to the haystack (only `statement`)

#### Scenario: Keyword hits an image question's media title (cross-medium dedup)

- **GIVEN** an image-medium question with `promptMedium: "image"`, a templated `statement: "Which landmark is shown?"`, and `media: { title: "Eiffel Tower", altText: "A wrought-iron lattice tower in Paris", ... }`
- **WHEN** `find_previous_questions` is called with `keywords: ["eiffel"]`
- **THEN** the row is returned even though "eiffel" is absent from its `statement` (it matched `media.title`)
- **AND** the row carries `matchedKeywords: ["eiffel"]`

#### Scenario: Text rows contribute no media text to the haystack

- **GIVEN** a text-medium question (`promptMedium` absent or `"text"`) with no `media`
- **WHEN** `find_previous_questions` is called with any `keywords`
- **THEN** matching considers only the `statement` and the row's answer-type-specific text (no media fields are read)

#### Scenario: category is not part of the keyword haystack

- **GIVEN** a question with `category: "Geography"` whose `statement`, `choices`, and freeform answer fields do not contain the word "geography"
- **WHEN** `find_previous_questions` is called with `keywords: ["geography"]` and no `categories` argument
- **THEN** the row is NOT matched by the keyword (the `category` field is reachable only via the `categories` criterion)

#### Scenario: Default match is "all" — every supplied criterion must hit

- **WHEN** `find_previous_questions` is called with `keywords: ["mozart"], categories: ["Music"]` and `match` is omitted
- **THEN** only rows whose haystack contains "mozart" AND whose `category` equals "Music" (case-insensitive) are returned

#### Scenario: match: "any" — at least one supplied criterion must hit

- **WHEN** `find_previous_questions` is called with `keywords: ["mozart"], categories: ["Music"], match: "any"`
- **THEN** the returned set is the union of (rows whose haystack mentions "mozart") and (rows in "Music")
- **AND** rows matching both are returned once, not twice

#### Scenario: match: "all" with only one criterion supplied

- **WHEN** `find_previous_questions` is called with `keywords: ["mozart"], match: "all"` (no other criteria)
- **THEN** the result is identical to calling with `keywords: ["mozart"], match: "any"`
- **AND** the result contains rows whose haystack contains "mozart"

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
