# Trivia Question Search

## Purpose

Question creation and discovery for trivia questions, including validation, search, and storage. All operations are scoped per-game: every tool takes a required `game: string` argument validated against `config.trivia.games[]`, and reads/writes target `data/plugins/trivia/games/<name>/`.
## Requirements
### Requirement: Find previous questions tool

The system SHALL provide a `find_previous_questions` MCP tool (member role) that searches past trivia questions by combining one or more array-shaped criteria with a top-level boolean combinator.

#### Top-level criteria

The tool SHALL accept the following array-shaped filter criteria. Within any single array, semantics are always OR — a row matches the criterion if ANY entry hits. An omitted array, or an empty array, SHALL be treated as "criterion not supplied" and SHALL NOT participate in the cross-criterion combinator.

- `games?: string[]` — each entry SHALL be validated against `config.trivia.games[]` per the `trivia-games` capability. Unknown entry → structured "unknown game" error citing the offending name. Disabled entries are permitted (read tool — frozen-archive semantics). When `games` is omitted or empty, the tool SHALL read `questions.json` from every game registered in `config.trivia.games[]`, skipping any whose file is absent on disk.
- `categories?: string[]` — case-insensitive exact match against the row's `category`. Row matches if its `category` equals any entry (case-insensitive).
- `seasons?: string[]` — each entry is either a season slug or the literal `"current"`. Row matches if its `season` equals any resolved entry. `"current"` SHALL be resolved per-game via `findCurrentSeason` against that game's `seasons.json`; if a game's `findCurrentSeason` returns `null`, `"current"` contributes no match for rows in that game. When `trivia.seasons.enabled` is `false`, the `seasons` argument SHALL be silently ignored and SHALL NOT participate in the combinator.
- `keywords?: string[]` — each entry is lowercased; the row matches if its lowercased `statement` includes any entry as a substring.
- `posted?: boolean` — a row matches this criterion iff the condition on `postedAt` is satisfied. `posted: true` matches rows with `postedAt !== undefined`; `posted: false` matches rows with `postedAt === undefined`. When omitted, the criterion is not supplied and SHALL NOT participate in the combinator.

#### Top-level combinator

The tool SHALL accept an optional `match: "any" | "all"` argument, defaulting to `"all"`. The combinator governs how supplied criteria combine across the top level — it does NOT alter the within-array OR semantics of any single criterion.

- `match: "all"` — a row matches the filter iff every supplied criterion is true for the row.
- `match: "any"` — a row matches the filter iff at least one supplied criterion is true for the row.

When NO criteria are supplied (every array criterion is omitted or empty), the tool SHALL return every question in scope (matching `recentBatchFromNow` and `limit` behavior as defined below). The combinator value is irrelevant in this case.

#### Per-row response

Each returned question SHALL carry, in addition to the safety-preserved fields enumerated in the `Find previous questions response excludes the answer key` requirement, the following:

- `game: string` — the game the row came from. Present on every row regardless of whether the call was cross-game or single-game.
- `matchedKeywords?: string[]` — present iff the call supplied a non-empty `keywords` array. Each entry SHALL be a member of the input `keywords` whose lowercased form is a substring of the row's lowercased `statement`. Order SHALL preserve the input `keywords` order. The field SHALL be absent when `keywords` was omitted or empty.

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

### Requirement: find_previous_questions supports filtering by posted state

The `find_previous_questions` MCP tool SHALL accept an optional `posted?: boolean` argument. When supplied, the value SHALL participate in the existing `match: "all" | "any"` top-level combinator as an additional criterion, governed by the same semantics as the other criteria.

- `posted: true` — a row matches this criterion iff `q.postedAt !== undefined`.
- `posted: false` — a row matches this criterion iff `q.postedAt === undefined` (the "staged" state).
- `posted` omitted — the criterion is not supplied and SHALL NOT participate in the combinator.

The tool's description SHALL document this third use case (staged-pool query) alongside the existing duplicate-detection and recent-batch-lookup use cases.

#### Scenario: posted: true returns only posted questions

- **GIVEN** a game's `questions.json` contains 5 questions where 3 have `postedAt` defined and 2 do not
- **WHEN** `find_previous_questions({ games: ["<game>"], posted: true, match: "all" })` is called
- **THEN** the returned questions are exactly the 3 posted questions

#### Scenario: posted: false returns only staged questions

- **GIVEN** a game's `questions.json` contains 5 questions where 3 have `postedAt` defined and 2 do not
- **WHEN** `find_previous_questions({ games: ["<game>"], posted: false, match: "all" })` is called
- **THEN** the returned questions are exactly the 2 unposted (staged) questions

#### Scenario: posted omitted returns all questions

- **GIVEN** a game's `questions.json` contains 5 questions in mixed posted/staged state
- **WHEN** `find_previous_questions({ games: ["<game>"], match: "all" })` is called (no `posted`)
- **THEN** the returned questions are all 5 (criterion not supplied; behavior unchanged from pre-change)

#### Scenario: posted combines with other criteria under match: "all"

- **GIVEN** the staged pool contains 3 staged questions for game `main` (one each for slots 0, 1, 2 of the current season) and 1 staged question for game `other`
- **WHEN** `find_previous_questions({ games: ["main"], seasons: ["current"], posted: false, match: "all" })` is called
- **THEN** the returned rows are exactly the 3 staged questions belonging to game `main` in the current season

#### Scenario: posted combines with other criteria under match: "any"

- **GIVEN** a question pool contains posted and staged questions across multiple games
- **WHEN** `find_previous_questions({ games: ["main"], posted: false, match: "any" })` is called
- **THEN** the returned rows are the union of (questions in game `main`) ∪ (questions with `postedAt` undefined)

### Requirement: posted: false rejects combination with recentBatchFromNow

The `find_previous_questions` MCP tool SHALL reject calls that combine `posted: false` with `recentBatchFromNow`. Because `recentBatchFromNow` internally requires `postedAt !== undefined && batchId !== undefined`, the combination would always return an empty set — likely a caller error. The tool SHALL return a structured error with a clear message naming both arguments.

The combination of `posted: true` (or omitted) with `recentBatchFromNow` SHALL remain permitted and SHALL behave as today.

#### Scenario: posted: false plus recentBatchFromNow rejected

- **GIVEN** a caller invokes `find_previous_questions({ games: ["main"], posted: false, recentBatchFromNow: 1 })`
- **WHEN** the tool validates the input
- **THEN** the tool returns a structured error citing both arguments and explaining the conflict
- **AND** no question scan is performed

### Requirement: save_question validates promptMedium and media

The `save_question` tool SHALL accept two new optional input fields:

- `promptMedium: "text" | "image"` — when absent, the stored record is stamped with `"text"` (the new default).
- `media: { kind: "image", url, altText, subjectId, title, license?, attribution? }` — required when `promptMedium === "image"`, forbidden when `promptMedium === "text"`.

The tool SHALL enforce these constraints at the boundary:

1. **Media required-when-image**: when `promptMedium === "image"`, `media` MUST be present and MUST contain non-empty `url`, `altText`, `subjectId`, and `title` strings, with `kind === "image"`. The tool SHALL reject calls missing or partial.
2. **Media forbidden-when-text**: when `promptMedium === "text"` (or absent), `media` MUST NOT be set. The tool SHALL reject calls that pass `media` without `promptMedium: "image"`.
3. **URL hygiene**: `media.url` MUST be an HTTPS URL. The tool SHALL reject http:// and non-URL strings.
4. **altText content**: `media.altText` MUST be a non-empty string ≤ 2000 characters at storage time. The tool SHALL reject calls with `altText` exceeding 2000 characters (this matches Slack Block Kit's `alt_text` limit; rejecting at save time means `post_questions` can pass the value through without re-truncation). It MUST NOT contain Block Kit markup (`*bold*`, `<@USERID>` mentions, channel pings) — text only, newlines permitted. The tool SHALL strip any Block Kit markup it finds before storing (defense-in-depth; the prompt should not be producing such content for altText).

The tool SHALL NOT impose any cross-axis constraint between `promptMedium` and `answersFormat`. All six combinations (`{text, image} × {boolean, choice, freeform}`) are valid and SHALL save successfully when the per-axis field validation passes. The freeform `expectedAnswer` field SHALL be permitted alongside `media` when `answersFormat: "freeform"` and `promptMedium: "image"` are both set.

When validation passes, the stored record SHALL carry `promptMedium` (always, including when `"text"` for new writes) and `media` (when `promptMedium === "image"`).

#### Scenario: Image + choice + media saves successfully

- **WHEN** `save_question` is called with `promptMedium: "image"`, `answersFormat: "choice"`, valid `media`, and the other required choice fields
- **THEN** the question is saved with `promptMedium`, `media`, and the choice answer key

#### Scenario: Image + boolean + media saves successfully

- **WHEN** `save_question` is called with `promptMedium: "image"`, `answersFormat: "boolean"`, `isTrue: true`, and a valid `media` object
- **THEN** the question is saved with `promptMedium`, `media`, and `isTrue`

#### Scenario: Image + freeform + media saves successfully

- **WHEN** `save_question` is called with `promptMedium: "image"`, `answersFormat: "freeform"`, `expectedAnswer: "Capybara"`, optional `acceptableAnswers: ["Hydrochoerus hydrochaeris"]`, and a valid `media` object
- **THEN** the question is saved with `promptMedium`, `media`, `expectedAnswer`, and `acceptableAnswers`

#### Scenario: Image without media is rejected

- **WHEN** `save_question` is called with `promptMedium: "image"` and no `media` argument
- **THEN** the tool returns an error explaining that media is required for image medium

#### Scenario: Text with media is rejected

- **WHEN** `save_question` is called with `promptMedium: "text"` (or absent) AND a `media` argument
- **THEN** the tool returns an error explaining that media is only allowed on image medium

#### Scenario: Non-HTTPS media URL is rejected

- **WHEN** `save_question` is called with `media.url: "http://example.com/image.jpg"` (or anything not starting with `https://`)
- **THEN** the tool returns an error requiring HTTPS

### Requirement: find_previous_subjects exact-match dedup tool

The system SHALL expose a `find_previous_subjects({ game, subjectId, season? })` MCP tool that returns saved questions whose `media.subjectId` equals the argument. The `game` (required, non-empty string) scopes the search to that game's question history. The `subjectId` (required, non-empty string) is the exact source-namespaced ID to match. The tool SHALL accept `season: "all" | "current" | "<slug>"` with the same semantics as `find_previous_questions` (`"all"` is the default).

The response shape SHALL be:

```
{ matches: Array<{ id, statement, createdAt, postedAt?, processedAt?, media: { title, subjectId } }>, count }
```

The response SHALL NOT include any answer-key fields (`correctIndex`, `isTrue`). The response SHALL NOT include `media.url`. The tool SHALL be available to the same role tier as `find_previous_questions`.

**Subject-ID matching is exact-string, with no normalization across formats.** The two `subjectId` schemes (`wikidata:Q<n>` preferred, `wikipedia:<slug>` fallback) are treated as distinct keys: a record stored with `wikidata:Q243` does NOT match a query for `wikipedia:Eiffel_Tower` even when they refer to the same real-world subject. Cross-format unification is intentionally NOT performed — Wikipedia page renames make slug-to-QID mapping non-stable over time, and an attempted normalization layer would silently drop dedup signal when the mapping drifts. Callers SHOULD pass the QID form whenever the source data has it; the `wikipedia:` fallback exists only for pages without a QID.

#### Scenario: Exact subjectId hit

- **GIVEN** a saved question with `media.subjectId: "wikidata:Q243"`
- **WHEN** `find_previous_subjects({ game, subjectId: "wikidata:Q243" })` is called
- **THEN** that question appears in `matches`

#### Scenario: No matches returns empty list

- **WHEN** the subjectId is not present on any saved question
- **THEN** the response is `{ matches: [], count: 0 }`

#### Scenario: Legacy questions without media are excluded

- **GIVEN** a game has questions saved before this change (no `media` field)
- **WHEN** `find_previous_subjects` runs
- **THEN** legacy records do not appear in `matches` regardless of the subjectId argument

#### Scenario: Malformed media field is treated as no media

- **GIVEN** a saved question whose `media` field is `null`, `{}`, or otherwise missing required keys (no `subjectId`)
- **WHEN** `find_previous_subjects` runs
- **THEN** the malformed record is silently excluded from `matches` (same treatment as legacy no-media records); the tool does NOT error on malformed data

#### Scenario: Cross-format subjectId does NOT match

- **GIVEN** a saved question with `media.subjectId: "wikidata:Q243"` (the Eiffel Tower's Wikidata QID)
- **WHEN** `find_previous_subjects({ game, subjectId: "wikipedia:Eiffel_Tower" })` is called
- **THEN** the query does NOT match (the two formats are distinct keys by design); the saved question does NOT appear in `matches`

#### Scenario: Season filter scopes the search

- **GIVEN** the same subjectId appears in questions from two different seasons
- **WHEN** `find_previous_subjects({ ..., season: "current" })` is called
- **THEN** only matches from the current season are returned

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

### Requirement: find_previous_questions surfaces promptMedium and media

`find_previous_questions` SHALL include `promptMedium` and `media` on each returned row whenever the underlying record carries them, so that a posting run reading the staged pool (`posted: false`) has everything it needs to rebuild an image-medium question's `image` block. Specifically:

- `promptMedium?: "text" | "image"` — present iff the record has a `promptMedium`. Absent on legacy and text-medium rows.
- `media?: { kind: "image"; url: string; altText: string; subjectId: string; title: string; license?: string; attribution?: string }` — present iff the record has `media` (i.e. image-medium questions). Optional `license`/`attribution` are included only when set.

Without these fields, a prep→post split could not render staged image questions: the post run would not see that a staged question is image-medium, nor have the `media.url` to build the block.

`get_question_history` SHALL likewise include `promptMedium` and `media` (same shape, same presence rules) for consistency when inspecting a single question.

#### Scenario: Image-medium staged question exposes promptMedium and media

- **GIVEN** a staged (`posted: false`) question with `promptMedium: "image"` and a populated `media`
- **WHEN** `find_previous_questions` returns it
- **THEN** the row carries `promptMedium: "image"` and a `media` object with `kind`, `url`, `altText`, `subjectId`, and `title` (plus `license`/`attribution` when set)

#### Scenario: Text-medium question omits promptMedium and media

- **WHEN** `find_previous_questions` returns a text-medium (or legacy) question
- **THEN** the row carries neither `promptMedium` nor `media`

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

### Requirement: Get question history tool

The Trivia plugin SHALL expose a `get_question_history` MCP tool that returns the answer key, the list of users caught cheating on the question, and the list of submitted answers, for a single question identified by `questionId` within a specified game.

The tool SHALL be gated to the `admin` role. The tool SHALL accept the following arguments:

- `game` (string, required) — the game slug; validated against `config.trivia.games[]` per the `trivia-games` capability. Read tool — succeeds against `enabled: false` games.
- `questionId` (string, required) — the ID of the trivia question to look up within the named game.

The tool SHALL look up the question only in `data/plugins/trivia/games/<game>/questions.json`, the cheat list only in `data/plugins/trivia/games/<game>/cheats.json`, and the answers only in `data/plugins/trivia/games/<game>/answers.json`. The `displayName` SHALL be looked up from the global `data/plugins/trivia/users.json`.

The tool SHALL return the question's answer key in an `answersFormat`-discriminated shape, dispatching through the per-format `AnswerTypeHandler` registry so each format owns its own response projection:

- **Boolean questions** (`answersFormat: "boolean"`): `{ answersFormat: "boolean", isTrue: boolean, responses: Array<{ userId, displayName, answer: boolean, correct?: boolean }> }`. Each response entry's `answer` field reflects the stored `SubmittedAnswer.answer` boolean.
- **Choice questions** (`answersFormat: "choice"`): `{ answersFormat: "choice", choices: string[], correctIndex: number, responses: Array<{ userId, displayName, answerIndex: number, correct?: boolean }> }`. Each response entry's `answerIndex` reflects the stored `SubmittedAnswer.answerIndex`.
- **Freeform questions** (`answersFormat: "freeform"`): `{ answersFormat: "freeform", expectedAnswer: string, acceptableAnswers?: string[], gradingNotes?: string, responses: Array<{ userId, displayName, answerText: string, correct?: boolean, judgeReason?: string }> }`. Each response entry's `answerText` reflects the stored `SubmittedAnswer.answerText`. When the reveal-time judge has stamped a verdict on the row, `correct` is the boolean verdict and `judgeReason` (when present) is the short label the judge emitted (e.g. `"multiple-guess"`, `"too-broad"`, `"typo-too-far"`, `"out-of-tolerance"`, `"judge-error"`). Rows still pending judging carry `correct: undefined` and SHALL be returned with `correct` absent from the response entry rather than present-with-undefined.

The tool SHALL ALSO return, regardless of format:

- `questionType: "fact" | "topical"` — projected from the stored `TriviaQuestion.questionType` (defaults to `"fact"` for legacy rows).
- `cheaterUserIds` (string array) — the deduplicated list of `cheaterUserId` values from every entry in the named game's `cheats.json` whose `questionId` matches the requested question.

When the resolved question record carries `context`, `sourceUrl`, or `eventDate`, the tool SHALL include those fields in the response payload (cross-format extras).

The tool's description SHALL instruct Claude that cheater identities are internal — Claude MUST NOT name caught cheaters in any user-facing output unless an admin explicitly asks for the list. The description SHALL also document all three format response shapes so Claude knows which fields to expect for each.

This requirement replaces a prior implementation that silently returned the boolean response shape for freeform questions (the `isChoice ? ... : booleanShape` ternary defaulted freeform to boolean), which produced misleading output. The new dispatch-through-handler approach ensures each format returns its correct shape.

#### Scenario: Returns boolean answer key, cheaters, and responses scoped to the game

- **WHEN** `get_question_history` is called with `game: "main"` and a `questionId` for a boolean question in that game
- **THEN** the response includes `answersFormat: "boolean"`, `questionType`, `isTrue`, plus the `cheaterUserIds` and `responses` arrays scoped to that game
- **AND** each response entry carries `answer: boolean`
- **AND** no response entry carries `answerIndex` or `answerText`

#### Scenario: Returns choice answer key, cheaters, and responses

- **WHEN** `get_question_history` is called for a choice question
- **THEN** the response includes `answersFormat: "choice"`, `questionType`, `choices`, `correctIndex`, plus `cheaterUserIds` and `responses` arrays
- **AND** each response entry carries `answerIndex: number`
- **AND** no response entry carries `answer` or `answerText`

#### Scenario: Returns freeform answer key, cheaters, and responses

- **WHEN** `get_question_history` is called for a freeform question with stored `expectedAnswer: "Paris"`, optional `acceptableAnswers: ["Paris, France"]`, and `gradingNotes: "Accept any reasonable form."`
- **THEN** the response includes `answersFormat: "freeform"`, `questionType`, `expectedAnswer: "Paris"`, `acceptableAnswers: ["Paris, France"]`, `gradingNotes: "Accept any reasonable form."`, plus `cheaterUserIds` and `responses` arrays
- **AND** each response entry carries `answerText: string`
- **AND** when the judge has scored an entry, the entry carries `correct: boolean`
- **AND** when the judge stamped a `judgeReason` on the row, the entry carries `judgeReason: string`
- **AND** no response entry carries `answer` or `answerIndex`

#### Scenario: Pending freeform responses omit `correct`

- **GIVEN** a freeform question with three submitted answers, none yet scored by the judge (`SubmittedAnswer.correct === undefined` on every row)
- **WHEN** `get_question_history` is called for that question
- **THEN** every entry in `responses[]` carries `answerText` and `userId` / `displayName`
- **AND** no entry carries a `correct` field (absence indicates pending judging)
- **AND** no entry carries a `judgeReason` field

#### Scenario: Mixed-state freeform responses

- **GIVEN** a freeform question with two scored responses (one `correct: true`, one `correct: false` with `judgeReason: "multiple-guess"`) and one pending response
- **WHEN** `get_question_history` is called
- **THEN** the scored entries carry `correct` (with the relevant boolean) and the false entry carries `judgeReason: "multiple-guess"`
- **AND** the pending entry carries neither `correct` nor `judgeReason`

#### Scenario: Topical question history includes sourceUrl

- **WHEN** `get_question_history` is called for a topical question with a stored `sourceUrl`
- **THEN** the response includes `sourceUrl` and (when present) `eventDate`
- **AND** the per-format shape (boolean / choice / freeform) is unaffected

#### Scenario: Question with context surfaces the context value

- **WHEN** `get_question_history` is called for a question whose record carries `context: "Quebec"`
- **THEN** the response includes `context: "Quebec"`
- **AND** the per-format shape (boolean / choice / freeform) is unaffected

### Requirement: save_question Accepts Freeform Fields

`save_question` SHALL accept `expectedAnswer: string` (required when `answersFormat: "freeform"`, forbidden otherwise), `acceptableAnswers?: string[]` (optional, freeform-only), and `gradingNotes?: string` (optional, freeform-only). The discriminator validation SHALL enforce that:

- `answersFormat: "freeform"` requires `expectedAnswer` and forbids `isTrue`, `choices`, `correctIndex`.
- `answersFormat: "boolean"` and `answersFormat: "choice"` forbid `expectedAnswer`, `acceptableAnswers`, `gradingNotes`.

The cross-format error messages SHALL identify the offending field and the active `answersFormat` so Claude can correct the call.

#### Scenario: Freeform save with required field

- **WHEN** `save_question` is called with `answersFormat: "freeform"`, `statement: "What is the capital of France?"`, and `expectedAnswer: "Paris"`
- **THEN** the question record is saved with those fields
- **AND** the response carries the saved record's id

#### Scenario: Freeform save with optional fields

- **WHEN** `save_question` is called with `answersFormat: "freeform"`, `expectedAnswer: "Paris"`, `acceptableAnswers: ["Paris, France", "City of Paris"]`, and `gradingNotes: "Accept any reasonable English-language form of the city name."`
- **THEN** the saved record carries all three freeform-specific fields

#### Scenario: Freeform save missing expectedAnswer

- **WHEN** `save_question` is called with `answersFormat: "freeform"` and no `expectedAnswer`
- **THEN** the tool returns an error identifying `expectedAnswer` as required for freeform questions
- **AND** no record is written

#### Scenario: Boolean save with freeform field

- **WHEN** `save_question` is called with `answersFormat: "boolean"`, `isTrue: true`, and `expectedAnswer: "Paris"` (mistakenly supplied)
- **THEN** the tool returns an error identifying `expectedAnswer` as not valid for boolean questions
- **AND** no record is written

#### Scenario: Freeform save with cross-format field

- **WHEN** `save_question` is called with `answersFormat: "freeform"` and `choices: ["a", "b"]` (mistakenly supplied)
- **THEN** the tool returns an error identifying `choices` as not valid for freeform questions
- **AND** no record is written

