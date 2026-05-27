## MODIFIED Requirements

### Requirement: seasons.json file schema

When `seasons.enabled` is `true`, the Trivia plugin SHALL maintain a `seasons.json` file inside each registered game's directory: `data/plugins/trivia/games/<game>/seasons.json`. Each game's timeline is independent. The schema of each file is:

```
{
  "seasons": Array<{
    "slug": string,                          // unique within this game; non-empty kebab-case
    "startedAt": number,                     // unix-ms when the season's active window begins
    "expectedEndAt": number,                 // unix-ms when the season's active window is expected to close
    "endedAt": number?,                      // unix-ms when the season was actually closed; absent for not-yet-ended seasons
    "theme": string?,                        // OPTIONAL short human-readable narrative label.
    "categories": string[]?,                 // OPTIONAL season-tier category pool. When absent, the pool resolves
                                             // via the cascade slot.categories → game.categories → categories.json.
                                             // When present, MUST be non-empty (deduped) — empty arrays are not allowed on disk.
    "answersFormat": Record<"boolean" | "choice", number>?,
    "questionType": Record<"fact" | "topical", number>?,
    "contexts": Array<{ name: string; weight?: number }>?,
    "format": {
      "questions": Array<{
        "label"?: string,
        "categories"?: string[],
        "answersFormat"?: Record<"boolean" | "choice", number>,
        "questionType"?: Record<"fact" | "topical", number>,
        "contexts"?: Array<{ name: string; weight?: number }>
      }>
    }?
  }>
}
```

Invariants (enforced by `upsert_season` at write time, **per game**):

1. Slug uniqueness _within this game's `seasons` array_. Two different games MAY use the same slug for their own seasons; the namespaces are independent.
2. Each entry satisfies `startedAt < (endedAt ?? expectedEndAt)`.
3. Each entry's `categories` array, **when present**, SHALL be non-empty. The field MAY be absent — an absent field signals cascade-inheritance (slot → game → global). An empty array on disk is NOT a valid representation of "inherit"; readers SHALL treat the field as absent if and only if the JSON key is missing.
4. No two entries' active windows `[startedAt, endedAt ?? expectedEndAt)` overlap _within the same game_.
5. When present, each entry's `answersFormat` map SHALL contain only the keys `"boolean"` and `"choice"`, each mapped to a non-negative integer (zero is allowed and means "never roll this format"), AND at least one key SHALL be mapped to a strictly positive value.
6. When present, each entry's `questionType` map SHALL contain only the keys `"fact"` and `"topical"`, each mapped to a non-negative integer, AND at least one key SHALL be mapped to a strictly positive value.
7. When present, each entry's `contexts` array SHALL be non-empty; every entry's `name` MUST be a string (empty string allowed); when present, `weight` MUST be a positive number; the array's `name` values MUST be unique.
8. When present, each entry's `format` SHALL satisfy the invariants in the "Per-season question format" requirement.
9. When present, each entry's `theme` SHALL be a non-empty trimmed string. An empty-after-trim value SHALL be rejected by `upsert_season` (callers should pass `null` to clear instead).

Per-game `seasons.json` files SHALL be created lazily — when any tool resolves `game = "X"` and finds no `games/X/seasons.json` while `trivia.seasons.enabled` is `true`, the plugin SHALL seed a starter season into that file before continuing. The starter entry's `slug` is `season-YYYY-MM` (current UTC month), `startedAt` is `Date.now()`, and `expectedEndAt` is end-of-current-UTC-month. The starter entry SHALL NOT carry a `categories`, `format`, `answersFormat`, `questionType`, `contexts`, or `theme` field — it inherits its category pool from the cascade (game's per-game `categories`, or the global `categories.json`).

The "current season" of a game at any moment is a _derived_ concept: the unique entry in that game's `seasons.json` where `startedAt <= now < (endedAt ?? expectedEndAt)`, or `null` if `now` falls in a gap between entries.

#### Scenario: Lazy bootstrap on first per-game tool call

- **GIVEN** `config.trivia.games[]` contains `{ name: "staging", enabled: true, ... }`
- **AND** `trivia.seasons.enabled` is `true`
- **AND** `data/plugins/trivia/games/staging/seasons.json` does NOT exist
- **AND** the global `categories.json` contains baseline entries
- **WHEN** any per-game tool (e.g. `get_ideas`) is called with `game: "staging"`
- **THEN** `data/plugins/trivia/games/staging/seasons.json` is created before the tool returns
- **AND** the file contains a `seasons` array with exactly one entry
- **AND** the entry's `slug` is non-empty and `startedAt < expectedEndAt`
- **AND** the entry has no `categories`, `answersFormat`, `questionType`, `contexts`, `theme`, or `format` field
- **AND** `get_ideas` continues to draw category ideas from the resolved cascade (game pool when set, else global `categories.json`)

#### Scenario: No bootstrap when seasons feature is disabled

- **GIVEN** `trivia.seasons.enabled` is `false`
- **WHEN** any per-game tool is called with `game: "staging"`
- **THEN** `data/plugins/trivia/games/staging/seasons.json` is NOT created

#### Scenario: No-overlap invariant is enforced within a game

- **GIVEN** `games/main/seasons.json` contains `{ slug: "may-2026", startedAt: T1, expectedEndAt: T3 }`
- **WHEN** `upsert_season` is called with `game: "main", slug: "june-2026", startedAt: T2, expectedEndAt: T4` where `T1 < T2 < T3 < T4`
- **THEN** the tool returns a structured overlap error
- **AND** `games/main/seasons.json` is unchanged

#### Scenario: Same slug allowed across different games

- **GIVEN** `games/main/seasons.json` contains `{ slug: "season-2026-05", ... }`
- **WHEN** `upsert_season` is called with `game: "sandbox", slug: "season-2026-05", ...`
- **THEN** the call succeeds; `games/sandbox/seasons.json` gains an entry with the same slug
- **AND** the two are independent records on independent timelines

#### Scenario: Back-to-back seasons are permitted within a game

- **GIVEN** `games/main/seasons.json` contains `{ slug: "may-2026", expectedEndAt: T }`
- **WHEN** `upsert_season` is called with `game: "main", slug: "june-2026", startedAt: T, expectedEndAt: T+30days`
- **THEN** the tool succeeds and the file gains the new entry

#### Scenario: Gap between seasons leaves current null within the game

- **GIVEN** `games/main/seasons.json` contains May with `expectedEndAt: May-31` and June with `startedAt: June-2`
- **WHEN** `now` is `June-1` (in the gap)
- **THEN** `findCurrentSeason(games/main/seasons.json, now)` returns `null`
- **AND** new question/answer/cheat writes to `games/main/*` during this window have no `season` field

#### Scenario: Upsert with existing slug is an UPDATE within a game

- **GIVEN** `games/main/seasons.json` contains an entry with `slug: "summer-2026"`
- **WHEN** `upsert_season` is called with `game: "main", slug: "summer-2026"` and `startedAt`/`expectedEndAt` provided AS IF creating
- **THEN** the call is treated as an UPDATE of the existing entry, not as a duplicate-slug error
- **AND** the existing entry's other fields are updated per the call

#### Scenario: Invalid answersFormat map is rejected

- **WHEN** an entry would be written with `answersFormat: { "boolean": 0, "choice": 0 }` (all-zero weights)
- **THEN** the write is rejected with an "answersFormat must have at least one positive weight" error

#### Scenario: answersFormat with unknown keys is rejected

- **WHEN** an entry would be written with `answersFormat: { "boolean": 1, "trivia": 1 }` (unknown key)
- **THEN** the write is rejected with an "answersFormat keys must be 'boolean' or 'choice'" error

#### Scenario: Invalid questionType map is rejected

- **WHEN** an entry would be written with `questionType: { "fact": 0, "topical": 0 }` (all-zero weights)
- **THEN** the write is rejected with a "questionType must have at least one positive weight" error

#### Scenario: questionType with unknown keys is rejected

- **WHEN** an entry would be written with `questionType: { "fact": 1, "news": 1 }` (unknown key)
- **THEN** the write is rejected with a "questionType keys must be 'fact' or 'topical'" error

#### Scenario: Empty contexts array is rejected

- **WHEN** an entry would be written with `contexts: []`
- **THEN** the write is rejected with a "contexts must be non-empty when present" error

#### Scenario: Duplicate context names are rejected

- **WHEN** an entry would be written with `contexts: [{ name: "Quebec" }, { name: "Quebec" }]`
- **THEN** the write is rejected with a "duplicate context name" error

#### Scenario: Invalid format on write rejected

- **WHEN** an entry would be written with `format: { questions: [] }`
- **THEN** the write is rejected with a "format.questions must be non-empty" error

#### Scenario: Empty-string theme is rejected

- **WHEN** an entry would be written with `theme: ""` or `theme: "   "` (whitespace-only)
- **THEN** the write is rejected with a "theme must be non-empty" error
- **AND** the season entry retains its prior `theme` value (or remains theme-less on CREATE)

#### Scenario: Cascading season-without-categories resolves to game pool

- **GIVEN** an entry in `games/main/seasons.json` has no `categories` field
- **AND** the game's stored config has `categories: ["History", "Geography"]`
- **WHEN** any reader resolves the active category pool for `main` during this season
- **THEN** the resolved pool is `["History", "Geography"]`
- **AND** the global `categories.json` is NOT consulted

#### Scenario: Cascading season-without-categories resolves to global when game has none

- **GIVEN** an entry in `games/main/seasons.json` has no `categories` field
- **AND** the game's stored config has no `categories` field
- **AND** the global `categories.json` is `["A", "B", "C"]`
- **WHEN** any reader resolves the active category pool for `main` during this season
- **THEN** the resolved pool is `["A", "B", "C"]`

### Requirement: upsert_season tool

When `seasons.enabled` is `true`, the Trivia plugin SHALL expose an `upsert_season` MCP tool gated to the `admin` role that creates a new season or updates an existing one within a specified game.

The tool SHALL accept a required `game: string` argument; the slug SHALL be validated against `config.trivia.games[]` per the `trivia-games` capability (unknown slug → structured "unknown game" error; `enabled: false` entry → structured "game is disabled" error, since upsert is a write).

The tool SHALL further accept:

- `slug` (string, required) — non-empty kebab-case identifier. Treated as immutable: if the slug already exists _within the named game's timeline_, the call is an update of that entry; otherwise the call creates a new entry. Slug renaming is not supported. Slugs may collide with slugs in other games' timelines without issue.
- `startedAt` (number, optional, unix-ms) — required on CREATE; on UPDATE, modifying it is rejected if the existing entry's `startedAt <= now` AND at least one question is already stamped to the slug.
- `expectedEndAt` (number, optional, unix-ms) — required on CREATE; on UPDATE, the new value MUST still satisfy `startedAt < (endedAt ?? newExpectedEndAt)`.
- `endedAt` (number, optional, unix-ms) — sets the actual end time.
- `categories` (string[] | null, optional) — the season's category pool.
  - On CREATE: when provided as a **non-empty** array, the new entry is written with `categories` set to exactly that list (deduped). When **omitted** OR provided as an **empty array**, the new entry is written **without** a `categories` field — the season inherits via the cascade (slot → game → global). `null` is rejected on CREATE.
  - On UPDATE: passing **`null`** clears the field, dropping the entry back into the cascade. Passing a **non-empty array** replaces the field with that list (deduped). Passing an **empty array** is rejected (callers should pass `null` to clear). **Omitting** preserves the existing field as-is.
- `theme` (string | null, optional) — per-season human-readable narrative label. Existing create/update/clear semantics unchanged.
- `answersFormat`, `questionType`, `freeformAnswerShape`, `contexts`, `difficulty`, `difficultyRatio`, `format`, `liveAnswersVisible`, `revealResponses`, `instructions`, `additionalInstructions` — existing create/update/clear semantics unchanged.

The tool SHALL:

1. Validate that `slug` is non-empty kebab-case.
2. Load the named game's `seasons.json` (initialize from scratch if missing).
3. If creating: require both `startedAt` and `expectedEndAt`. Resolve `categories`: when `args.categories` is a non-empty array, normalize (dedupe) and write that list; when `args.categories` is omitted or empty, write the entry **without** a `categories` field. Reject `args.categories === null` on CREATE with a "use omit instead of null to inherit on create" error. Validate `theme` (when provided) is a non-empty trimmed string. Verify no-overlap invariant. Validate the remaining axes per their existing invariants.
4. If updating: load the existing entry, apply the passed fields (omit-to-keep semantics; explicit `null` for `categories` / `theme` / `answersFormat` / `questionType` / `freeformAnswerShape` / `contexts` / `difficulty` / `difficultyRatio` / `format` / `liveAnswersVisible` / `revealResponses` / `instructions` / `additionalInstructions` clears the respective field), re-validate, and reject any attempt to mutate `startedAt` of an already-started season that has stamped questions.
5. Atomically write the new `games/<game>/seasons.json`.

The previous "season must have at least one category" guard at write time is **removed** — a season with no `categories` field is now a valid representation (cascade-inheriting). The non-empty invariant continues to apply ONLY when the field is present.

Return shape: `{ game, slug, action: "created" | "updated", startedAt, expectedEndAt, endedAt, hasCategories, categoriesCount, inheritsCategories, hasTheme, hasAnswersFormat, hasQuestionType, hasFreeformAnswerShape, hasContexts, hasDifficulty, hasDifficultyRatio, hasFormat, slotCount, hasLiveAnswersVisible, hasRevealResponses, hasInstructions, hasAdditionalInstructions }`. `hasCategories` is `true` iff the resulting entry has a `categories` field set. `categoriesCount` is the length of that field (0 when absent). `inheritsCategories` is `!hasCategories`. `slotCount` is `format.questions.length` when `hasFormat`, else `0`.

#### Scenario: Create a future season with format

- **GIVEN** `games/main/seasons.json` contains only the active "may-2026" season
- **WHEN** `upsert_season` is called with `game: "main", slug: "june-2026", startedAt: <June 1>, expectedEndAt: <June 30>, format: { questions: [{ label: "GK Boolean" }, { label: "History Choice", answersFormat: { boolean: 0, choice: 1 }, categories: ["History"] }] }`
- **THEN** the response is `{ game: "main", slug: "june-2026", action: "created", hasFormat: true, slotCount: 2, hasCategories: false, inheritsCategories: true, hasTheme: false, ... }`
- **AND** the new entry carries the provided `format` verbatim
- **AND** the new entry has no `categories` field (cascade-inheriting)

#### Scenario: Update a season's format mid-season

- **GIVEN** the active "may-2026" season has `startedAt <= now` and a 1-slot format
- **WHEN** `upsert_season(game: "main", slug: "may-2026", { format: { questions: [{ label: "A" }, { label: "B" }] } })` is called
- **THEN** the response is `{ game: "main", slug: "may-2026", action: "updated", hasFormat: true, slotCount: 2, ... }`
- **AND** the entry's `format` is the new 2-slot definition

#### Scenario: Create a themed future season (categories replace cascade)

- **WHEN** `upsert_season` is called with `game: "main", slug: "june-2026", categories: ["Cephalopods", "Coral Reefs", "Tides"]`
- **THEN** the new entry's `categories` is exactly the provided list (no baseline mixing)
- **AND** the response carries `hasCategories: true, inheritsCategories: false, categoriesCount: 3`

#### Scenario: Create a non-themed season (omit categories → inherit from cascade)

- **GIVEN** the global `categories.json` contains 50 baseline entries
- **WHEN** `upsert_season` is called with `game: "main"` as a create with no `categories` arg
- **THEN** the new entry has no `categories` field on disk
- **AND** the response carries `hasCategories: false, inheritsCategories: true, categoriesCount: 0`
- **AND** subsequent `get_ideas(game: "main")` calls draw from the game's `categories` if set, else from `categories.json`

#### Scenario: Create with empty categories arg is equivalent to omitting

- **WHEN** `upsert_season` is called with `game: "main"` as a create and `categories: []`
- **THEN** the new entry has no `categories` field on disk
- **AND** the response carries `hasCategories: false, inheritsCategories: true`

#### Scenario: Create with categories null rejected

- **WHEN** `upsert_season` is called with `game: "main"` as a create and `categories: null`
- **THEN** the call is rejected with a "use omit instead of null to inherit on create" error
- **AND** no entry is written

#### Scenario: Provided categories are deduped

- **WHEN** `upsert_season(... categories: ["Cephalopods", "Cephalopods", "Tides"])` is called
- **THEN** the resulting entry's `categories` is `["Cephalopods", "Tides"]`

#### Scenario: Update categories with null clears the field

- **GIVEN** the active "may-2026" season has `categories: ["History", "Geography"]`
- **WHEN** `upsert_season(game: "main", slug: "may-2026", { categories: null })` is called
- **THEN** the response is `{ game: "main", slug: "may-2026", action: "updated", hasCategories: false, inheritsCategories: true, ... }`
- **AND** the entry no longer has a `categories` field on disk
- **AND** subsequent reads resolve the pool via the cascade (game's pool, else global)

#### Scenario: Update categories with new non-empty array replaces the list

- **GIVEN** the active "may-2026" season has `categories: ["History"]`
- **WHEN** `upsert_season(game: "main", slug: "may-2026", { categories: ["Music", "Sports"] })` is called
- **THEN** the response is `{ ..., action: "updated", hasCategories: true, inheritsCategories: false, categoriesCount: 2 }`
- **AND** the entry's `categories` on disk is `["Music", "Sports"]`

#### Scenario: Update categories with empty array rejected

- **GIVEN** the active "may-2026" season has `categories: ["History"]`
- **WHEN** `upsert_season(game: "main", slug: "may-2026", { categories: [] })` is called
- **THEN** the call is rejected with a "pass null to clear or pass a non-empty list to replace" error
- **AND** the season's `categories` is unchanged

#### Scenario: Update with categories omitted preserves existing pool

- **GIVEN** the active "may-2026" season has `categories: ["History", "Music"]`
- **WHEN** `upsert_season(game: "main", slug: "may-2026", { expectedEndAt: <T> })` is called (no `categories` key)
- **THEN** the entry's `categories` remains `["History", "Music"]`

#### Scenario: Update a future season's expected end

- **GIVEN** `games/main/seasons.json` contains a future "june-2026" season with `expectedEndAt: June-30`
- **WHEN** `upsert_season` is called with `game: "main", slug: "june-2026", expectedEndAt: <July 7>`
- **THEN** the response is `{ game: "main", slug: "june-2026", action: "updated", ... }`
- **AND** the entry's `expectedEndAt` is updated; its `startedAt` and `categories` are unchanged

#### Scenario: Update an existing season's endedAt (mark closed)

- **GIVEN** the active "may-2026" season in `games/main/seasons.json` has no `endedAt`
- **WHEN** `upsert_season` is called with `game: "main", slug: "may-2026", endedAt: <now>`
- **THEN** the entry's `endedAt` is set to the provided value
- **AND** `findCurrentSeason(games/main/seasons.json, now)` no longer returns "may-2026" if `endedAt <= now`

#### Scenario: Overlap rejection on update (within a game)

- **GIVEN** `games/main/seasons.json` contains "may-2026" `[May-1, May-31]` and "june-2026" `[June-1, June-30]`
- **WHEN** `upsert_season(game: "main", slug: "may-2026", { expectedEndAt: <June 15> })` is called
- **THEN** the call is rejected with an overlap error (the proposed window overlaps june-2026 within `main`)

#### Scenario: Cannot mutate startedAt of an already-started season with stamped questions

- **GIVEN** the active "may-2026" season in `games/main/seasons.json` has `startedAt: <April 24>` (in the past)
- **AND** at least one question is stamped with `season: "may-2026"`
- **WHEN** `upsert_season(game: "main", slug: "may-2026", { startedAt: <April 26> })` is called
- **THEN** the call is rejected with a "cannot shift the past" error

#### Scenario: Unknown game rejected

- **WHEN** `upsert_season` is called with `game: "ghost"`
- **THEN** the tool returns a structured "unknown game" error

#### Scenario: Disabled game refuses upsert

- **GIVEN** `config.trivia.games[]` contains `{ name: "retired", enabled: false, ... }`
- **WHEN** `upsert_season` is called with `game: "retired"` and otherwise-valid args
- **THEN** the tool returns a structured "game is disabled" error

#### Scenario: answersFormat with all-zero weights rejected

- **WHEN** `upsert_season` is called with `answersFormat: { "boolean": 0, "choice": 0 }`
- **THEN** the call is rejected with an "answersFormat must have at least one positive weight" error

#### Scenario: answersFormat with unknown keys rejected

- **WHEN** `upsert_season` is called with `answersFormat: { "boolean": 1, "essay": 1 }`
- **THEN** the call is rejected with an "answersFormat keys must be 'boolean' or 'choice'" error

#### Scenario: questionType with all-zero weights rejected

- **WHEN** `upsert_season` is called with `questionType: { "fact": 0, "topical": 0 }`
- **THEN** the call is rejected with a "questionType must have at least one positive weight" error

#### Scenario: questionType with unknown keys rejected

- **WHEN** `upsert_season` is called with `questionType: { "fact": 1, "news": 1 }`
- **THEN** the call is rejected with a "questionType keys must be 'fact' or 'topical'" error

#### Scenario: contexts with empty array rejected

- **WHEN** `upsert_season` is called with `contexts: []`
- **THEN** the call is rejected with a "contexts must be non-empty when present" error

#### Scenario: contexts with duplicate names rejected

- **WHEN** `upsert_season` is called with `contexts: [{ name: "Quebec" }, { name: "Quebec" }]`
- **THEN** the call is rejected with a "duplicate context name" error

#### Scenario: Invalid slug rejected

- **WHEN** `upsert_season` is called with `game: "main"` and `slug: "Has Spaces"` or `"UPPER"` or `""`
- **THEN** the call is rejected with a slug-format error

#### Scenario: Tool is gated to admin

- **WHEN** a session's user has role below `admin`
- **THEN** `upsert_season` is absent from the session's MCP catalog

### Requirement: save_question slot binding

When the active season has a `format`, the `save_question` MCP tool SHALL require a `slot: { index: number, label?: string }` argument. The tool SHALL:

1. Reject the call with a structured "slot required" error if `slot` is omitted.
2. Reject the call with a structured "slot index out of range" error if `slot.index` is not in `[0, format.questions.length)`.
3. Resolve the slot's effective `answersFormat` via the cascade `slot.answersFormat ?? season.answersFormat ?? config.trivia.answersFormat` and reject the call with an "answers format not permitted by slot" error if the question's actual `answersFormat` value is not in the slot's permitted set (weight > 0).
4. Resolve the slot's effective `questionType` via the cascade `slot.questionType ?? season.questionType ?? config.trivia.questionType` and reject the call with a "question type not permitted by slot" error if the question's actual `questionType` value is not in the slot's permitted set (weight > 0).
5. Resolve the slot's effective `categories` via the cascade `slot.categories → season.categories → game.categories → categories.json` (the same resolver used by `get_ideas`) and reject the call with a structured `CATEGORY_NOT_IN_POOL` error if the question's `category` is not in that resolved pool. The error payload SHALL conform to `{ code: "CATEGORY_NOT_IN_POOL", source: "slot" | "season" | "game" | "global", categories: string[] }`, where `source` is the tier the resolver returned and `categories` is the resolved pool — identical to the schema used by `save_question`'s top-level category validation in the `trivia-categories` capability.
6. Resolve the slot's effective `contexts` via the cascade `slot.contexts ?? season.contexts ?? config.trivia.contexts` (may be absent) and reject the call with a "context not in slot lens list" error if a non-empty `context` argument is provided but does not appear in the resolved contexts list.
7. Snapshot `slot: { index, label }` onto the saved question record where `label` is taken from `format.questions[index].label` at the moment of write.

When the active season has no `format`, the `save_question` tool SHALL reject any `slot` argument with a structured "season has no format" error.

#### Scenario: Save with valid slot succeeds and snapshots label

- **GIVEN** the active season has `format: { questions: [{ label: "GK 1" }, { label: "History Choice", categories: ["History"], answersFormat: { choice: 1 } }] }`
- **WHEN** `save_question` is called with `slot: { index: 1 }`, `answersFormat: "choice"`, `questionType: "fact"`, `category: "History"`, valid choices/correctIndex
- **THEN** the call succeeds and the saved record carries `slot: { index: 1, label: "History Choice" }`

#### Scenario: Missing slot argument when format present

- **GIVEN** the active season has a `format`
- **WHEN** `save_question` is called with no `slot` argument
- **THEN** the call is rejected with a "slot required" error

#### Scenario: Slot index out of range

- **WHEN** `save_question` is called with `slot: { index: 99 }` on a season with a 2-slot format
- **THEN** the call is rejected with a "slot index out of range" error

#### Scenario: Answers format not permitted by slot

- **GIVEN** a season's slot 0 has `answersFormat: { choice: 1 }` (boolean weight 0)
- **WHEN** `save_question` is called with `slot: { index: 0 }, answersFormat: "boolean", ...`
- **THEN** the call is rejected with an "answers format not permitted by slot" error

#### Scenario: Question type not permitted by slot

- **GIVEN** a season's slot 0 has `questionType: { fact: 1 }` (topical weight 0)
- **WHEN** `save_question` is called with `slot: { index: 0 }, questionType: "topical", ...`
- **THEN** the call is rejected with a "question type not permitted by slot" error

#### Scenario: Category not in slot's resolved pool

- **GIVEN** a season's slot 0 has `categories: ["History"]`
- **WHEN** `save_question` is called with `slot: { index: 0 }, category: "Science"`
- **THEN** the call is rejected with a "category not in slot pool" error
- **AND** the error payload identifies the resolved source as `"slot"` and lists `["History"]`

#### Scenario: Slot inherits category pool from season

- **GIVEN** a season has `categories: ["History", "Geography"]` and a slot with no `categories` override
- **WHEN** `save_question` is called with `slot: { index: 0 }, category: "History"`
- **THEN** the call succeeds (category is in the season's pool)

#### Scenario: Slot inherits category pool from game when season has none

- **GIVEN** a season has no `categories` field, no slot-tier `categories` override, and the game's stored config has `categories: ["Music", "Sports"]`
- **WHEN** `save_question` is called with `slot: { index: 0 }, category: "Music"`
- **THEN** the call succeeds (resolved from the game tier)
- **AND** if called with `category: "History"` instead, the call is rejected with the error payload identifying source `"game"` and listing `["Music", "Sports"]`

#### Scenario: Slot inherits category pool from global categories.json

- **GIVEN** a season has no `categories` field, no slot-tier `categories` override, the game has no `categories` field, and the global `categories.json` is `["A", "B", "C"]`
- **WHEN** `save_question` is called with `slot: { index: 0 }, category: "B"`
- **THEN** the call succeeds (resolved from the global tier)

#### Scenario: Slot cascades through inheriting season to game pool

- **GIVEN** the active season has `format: { questions: [{ label: "GK" }] }` (slot 0 has no `categories` override)
- **AND** the season has no `categories` field
- **AND** the game's stored config has `categories: ["Music", "Sports"]`
- **WHEN** `save_question` is called with `slot: { index: 0 }, category: "Music"`
- **THEN** the call succeeds (cascade walked `slot → season → game`)
- **AND** if called with `category: "History"` instead, the call is rejected with the `CATEGORY_NOT_IN_POOL` error payload identifying source `"game"` and listing `["Music", "Sports"]`

#### Scenario: Context not in slot's lens list

- **GIVEN** a season's slot 0 has `contexts: [{ name: "Quebec" }]`
- **WHEN** `save_question` is called with `slot: { index: 0 }, context: "International"`
- **THEN** the call is rejected with a "context not in slot lens list" error

#### Scenario: Slot argument rejected when season has no format

- **GIVEN** the active season has no `format`
- **WHEN** `save_question` is called with any `slot` argument
- **THEN** the call is rejected with a "season has no format" error

### Requirement: Lazy per-game season bootstrap

Per-game seasons bootstrap SHALL happen lazily on first use of a game's `seasons.json` rather than at plugin-load time. The previous plugin-load-time bootstrap (which created `data/plugins/trivia/seasons.json` once) is removed.

When any tool resolves a `game` argument AND `trivia.seasons.enabled` is `true` AND the named game's `data/plugins/trivia/games/<game>/seasons.json` is missing, the plugin SHALL seed that file with exactly one entry whose:

- `slug` is computed deterministically as `season-YYYY-MM` based on the current UTC month.
- `startedAt` is `Date.now()`.
- `expectedEndAt` is end-of-current-UTC-month.

The starter entry SHALL NOT include a `categories` field — the season inherits its pool from the cascade (game's `categories` if set, else the global `categories.json`). This is a behavior change from the previous "copy the global `categories.json`" rule, motivated by aligning with the documented cascade in `src/plugins/trivia/domain/categories.ts`.

Pre-migration data moved into the per-game directory layout by migration 019 (whether the destination is `legacy-<channel>`, an existing config entry, or the fallback `initialgame`) is NOT backfilled with a `season` field — those entries remain untagged and contribute to all-time totals only.

#### Scenario: First per-game tool call seeds seasons.json without categories

- **GIVEN** `trivia.seasons.enabled` is `true` and `games/staging/seasons.json` does not exist
- **WHEN** `get_ideas` is called with `game: "staging"`
- **THEN** `games/staging/seasons.json` is created with one starter entry before `get_ideas` returns
- **AND** the starter entry has no `categories` field on disk
- **AND** `get_ideas`'s response draws ideas from the resolved cascade (game's `categories` if set, else `categories.json`)

#### Scenario: Subsequent calls do not re-seed

- **GIVEN** `games/staging/seasons.json` already exists
- **WHEN** any tool is called with `game: "staging"`
- **THEN** no seasons bootstrap fires
- **AND** the file is unchanged

#### Scenario: Pre-migration data remains untagged

- **GIVEN** migration 019 moved flat data into a game's `games/<name>/{questions,answers,cheats}.json` directory
- **AND** `trivia.seasons.enabled` is enabled after the migration
- **AND** `games/initialgame/seasons.json` is seeded on first tool call with `game: "initialgame"`
- **WHEN** any tool reads the migrated entries in `games/initialgame/questions.json`
- **THEN** the migrated entries continue to have no `season` field

### Requirement: list_seasons tool

When `seasons.enabled` is `true`, the Trivia plugin SHALL expose a `list_seasons` MCP tool gated to the `admin` role that returns every entry on a specified game's timeline with full details, including each season's explicitly-set axis configuration so admins can audit the cascade without reading the seasons.json file by hand.

The tool SHALL accept a required `game: string` argument validated against `config.trivia.games[]`. Read tool — succeeds against `enabled: false` games. The tool's analysis SHALL be scoped exclusively to `data/plugins/trivia/games/<game>/seasons.json` (lazy-seeded if missing).

The return shape SHALL be:

```
{
  game: string,
  seasons: Array<{
    slug: string,
    startedAt: number,
    expectedEndAt: number,
    endedAt: number | null,
    categories?: string[],
    resolvedCategoriesCount: number,
    resolvedCategoriesSource: "season" | "game" | "global",
    status: "past" | "current" | "future",
    theme?: string,
    answersFormat?: TriviaAnswersFormatWeights,
    questionType?: TriviaQuestionTypeWeights,
    freeformAnswerShape?: TriviaFreeformAnswerShapeWeights,
    contexts?: TriviaContextEntry[],
    difficulty?: TriviaDifficultyConfig,
    difficultyRatio?: TriviaDifficultyRatioConfig,
    format?: {
      questions: Array<{
        label?: string,
        categories?: string[],
        answersFormat?: TriviaAnswersFormatWeights,
        questionType?: TriviaQuestionTypeWeights,
        freeformAnswerShape?: TriviaFreeformAnswerShapeWeights,
        contexts?: TriviaContextEntry[],
        difficulty?: TriviaDifficultyConfig,
        difficultyRatio?: TriviaDifficultyRatioConfig
      }>
    }
  }>,
  total: number
}
```

The `status` field is derived per entry against `Date.now()`:

- `"future"` when `startedAt > now`
- `"past"` when `(endedAt ?? expectedEndAt) <= now`
- `"current"` otherwise

The `categories` field SHALL be present on a season entry IF AND ONLY IF the entry's stored record carries an explicit `categories` field. Absent → the season inherits from the game / global cascade. The `resolvedCategoriesCount` and `resolvedCategoriesSource` fields SHALL ALWAYS be present and reflect the count and tier (`"season" | "game" | "global"`) that the resolver currently returns for this season — surfacing the inheritance state so admins can audit without re-deriving it.

The `theme`, `answersFormat`, `questionType`, `freeformAnswerShape`, `contexts`, `difficulty`, `difficultyRatio`, and `format` fields SHALL be present on a season entry IF AND ONLY IF the season's stored record carries an explicit value for that field. Absent fields signal that the season relies on the next tier of the cascade. Slot entries inside `format.questions` follow the same rule.

Entries SHALL be returned in their stored order. The tool's description SHALL explicitly state the cascade rule (slot → season → game → workspace → built-in default for axis fields; slot → season → game → global categories.json for categories) and point Claude at `list_games` for the game tier, so the response can be reasoned about without out-of-band knowledge.

#### Scenario: Returns every timeline entry for the named game with status flags

- **GIVEN** `games/main/seasons.json` contains a past season, the active season, and a queued future season
- **WHEN** `list_seasons` is invoked with `game: "main"`
- **THEN** the response includes all three entries from the `main` timeline
- **AND** the past entry's `status` is `"past"`
- **AND** the active entry's `status` is `"current"`
- **AND** the future entry's `status` is `"future"`
- **AND** no entries from `games/sandbox/seasons.json` appear in the response

#### Scenario: categories present when explicitly set

- **GIVEN** a season has `categories: ["History", "Geography"]` on disk
- **WHEN** `list_seasons` is invoked
- **THEN** the entry has `categories: ["History", "Geography"]` in the response
- **AND** `resolvedCategoriesCount: 2`
- **AND** `resolvedCategoriesSource: "season"`

#### Scenario: categories absent when inheriting from game

- **GIVEN** a season has no `categories` field and the game has `categories: ["Music", "Sports", "Film"]`
- **WHEN** `list_seasons` is invoked
- **THEN** the entry has NO `categories` field in the response
- **AND** `resolvedCategoriesCount: 3`
- **AND** `resolvedCategoriesSource: "game"`

#### Scenario: categories absent when inheriting from global

- **GIVEN** a season has no `categories` field, the game has no `categories` field, and `categories.json` has 50 entries
- **WHEN** `list_seasons` is invoked
- **THEN** the entry has NO `categories` field in the response
- **AND** `resolvedCategoriesCount: 50`
- **AND** `resolvedCategoriesSource: "global"`

#### Scenario: Season-tier axis values are surfaced when set

- **GIVEN** the active season has `freeformAnswerShape: { name: 3, number: 0, ...others: 1 }` explicitly stored on its entry, no `questionType` set, and no `format`
- **WHEN** `list_seasons` is invoked
- **THEN** that entry's `freeformAnswerShape` matches the stored value exactly
- **AND** the entry has no `questionType` field
- **AND** the entry has no `format` field

#### Scenario: Slot-tier axis values inside format.questions are surfaced when set

- **GIVEN** the active season has `format: { questions: [{}, { label: "Lightning", freeformAnswerShape: { name: 1, place: 0, phrase: 0, title: 0, date: 0, number: 0, other: 0 } }] }`
- **WHEN** `list_seasons` is invoked
- **THEN** `format.questions[0]` has no axis fields (slot 0 overrides nothing)
- **AND** `format.questions[1].label === "Lightning"`
- **AND** `format.questions[1].freeformAnswerShape` matches the stored value
- **AND** `format.questions[1]` has no `answersFormat` / `questionType` / `contexts` / `difficulty` fields (slot 1 only set freeformAnswerShape)

#### Scenario: theme is surfaced when set, absent when not

- **GIVEN** one season has `theme: "Halloween Spooktacular"` and another has no theme
- **WHEN** `list_seasons` is invoked
- **THEN** the themed entry has `theme: "Halloween Spooktacular"`
- **AND** the non-themed entry has no `theme` field

#### Scenario: Lazy-seed happens when seasons.json missing

- **GIVEN** `games/main/seasons.json` is missing and `trivia.seasons.enabled` is `true`
- **WHEN** `list_seasons` is invoked with `game: "main"`
- **THEN** the lazy-seed runs and creates `games/main/seasons.json` with a starter entry
- **AND** the response includes that one starter entry
- **AND** the starter entry has no `categories` field but carries `resolvedCategoriesCount` and `resolvedCategoriesSource`

#### Scenario: Unknown game rejected

- **WHEN** `list_seasons` is called with `game: "ghost"`
- **THEN** the tool returns a structured "unknown game" error

#### Scenario: Tool is gated to admin

- **WHEN** a session's user has role below `admin`
- **THEN** `list_seasons` is absent from the session's MCP catalog
