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
    "categories": string[],                  // the season's category pool (non-empty)
    "answersFormat": Record<"boolean" | "choice", number>?
                                             // OPTIONAL per-season answers-format weights; renamed from "questionTypes" pre-change.
                                             // When absent, get_ideas falls back to config.trivia.answersFormat.
    "questionType": Record<"fact" | "topical", number>?
                                             // NEW — OPTIONAL per-season question-type weights (fact vs topical).
                                             // When absent, get_ideas falls back to config.trivia.questionType.
    "contexts": Array<{ name: string; weight?: number }>?
                                             // NEW — OPTIONAL per-season lens weights for the contexts axis.
                                             // When absent, get_ideas falls back to config.trivia.contexts (which may itself be absent).
    "format": {
      "questions": Array<{
        "label"?: string,
        "categories"?: string[],
        "answersFormat"?: Record<"boolean" | "choice", number>,
        "questionType"?: Record<"fact" | "topical", number>,
        "contexts"?: Array<{ name: string; weight?: number }>
      }>
    }?                                       // OPTIONAL per-season question composition; when absent, behavior is single-question-per-fire
  }>
}
```

Invariants (enforced by `upsert_season` at write time, **per game**):

1. Slug uniqueness _within this game's `seasons` array_. Two different games MAY use the same slug for their own seasons; the namespaces are independent.
2. Each entry satisfies `startedAt < (endedAt ?? expectedEndAt)`.
3. Each entry's `categories` array is non-empty.
4. No two entries' active windows `[startedAt, endedAt ?? expectedEndAt)` overlap _within the same game_.
5. When present, each entry's `answersFormat` map SHALL contain only the keys `"boolean"` and `"choice"`, each mapped to a non-negative integer (zero is allowed and means "never roll this format"), AND at least one key SHALL be mapped to a strictly positive value.
6. When present, each entry's `questionType` map SHALL contain only the keys `"fact"` and `"topical"`, each mapped to a non-negative integer, AND at least one key SHALL be mapped to a strictly positive value.
7. When present, each entry's `contexts` array SHALL be non-empty; every entry's `name` MUST be a string (empty string allowed); when present, `weight` MUST be a positive number; the array's `name` values MUST be unique.
8. When present, each entry's `format` SHALL satisfy the invariants in the "Per-season question format" requirement (non-empty `questions`, valid slot fields including any of the new `answersFormat` / `questionType` / `contexts` slot overrides).

Per-game `seasons.json` files SHALL be created lazily — when any tool resolves `game = "X"` and finds no `games/X/seasons.json` while `trivia.seasons.enabled` is `true`, the plugin SHALL seed a starter season into that file before continuing. The starter entry's `slug` is `season-YYYY-MM` (current UTC month), `startedAt` is `Date.now()`, `expectedEndAt` is end-of-current-UTC-month, and `categories` is a copy of the global `categories.json`. The starter entry SHALL NOT carry a `format`, `answersFormat`, `questionType`, or `contexts` field.

The "current season" of a game at any moment is a _derived_ concept: the unique entry in that game's `seasons.json` where `startedAt <= now < (endedAt ?? expectedEndAt)`, or `null` if `now` falls in a gap between entries.

#### Scenario: Lazy bootstrap on first per-game tool call

- **GIVEN** `config.trivia.games[]` contains `{ name: "staging", enabled: true, ... }`
- **AND** `trivia.seasons.enabled` is `true`
- **AND** `data/plugins/trivia/games/staging/seasons.json` does NOT exist
- **AND** the global `categories.json` contains baseline entries
- **WHEN** any per-game tool (e.g. `get_ideas`) is called with `game: "staging"`
- **THEN** `data/plugins/trivia/games/staging/seasons.json` is created before the tool returns
- **AND** the file contains a `seasons` array with exactly one entry
- **AND** the entry's `slug` is non-empty, `startedAt < expectedEndAt`, and `categories` is a copy of the global `categories.json`
- **AND** the entry has no `answersFormat`, `questionType`, `contexts`, or `format` field

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

### Requirement: upsert_season tool

When `seasons.enabled` is `true`, the Trivia plugin SHALL expose an `upsert_season` MCP tool gated to the `admin` role that creates a new season or updates an existing one within a specified game.

The tool SHALL accept a required `game: string` argument; the slug SHALL be validated against `config.trivia.games[]` per the `trivia-games` capability (unknown slug → structured "unknown game" error; `enabled: false` entry → structured "game is disabled" error, since upsert is a write).

The tool SHALL further accept:

- `slug` (string, required) — non-empty kebab-case identifier. Treated as immutable: if the slug already exists _within the named game's timeline_, the call is an update of that entry; otherwise the call creates a new entry. Slug renaming is not supported. Slugs may collide with slugs in other games' timelines without issue.
- `startedAt` (number, optional, unix-ms) — required on CREATE; on UPDATE, modifying it is rejected if the existing entry's `startedAt <= now`.
- `expectedEndAt` (number, optional, unix-ms) — required on CREATE; on UPDATE, the new value MUST still satisfy `startedAt < (endedAt ?? newExpectedEndAt)`.
- `endedAt` (number, optional, unix-ms) — sets the actual end time.
- `categories` (string[], optional) — the season's category pool. Replace-or-baseline semantics on CREATE; ignored on UPDATE.
- `answersFormat` (`Record<"boolean" | "choice", number>` | null, optional) — per-season answers-format weights (renamed from `questionTypes`). On CREATE, stored verbatim. On UPDATE, an object value replaces the entry's existing `answersFormat`; explicit `null` clears the field. Mutation post-`startedAt` is permitted.
- `questionType` (`Record<"fact" | "topical", number>` | null, optional) — NEW per-season fact/topical weights. Same create/update/clear semantics as `answersFormat`. Mutation post-`startedAt` is permitted.
- `contexts` (`Array<{ name: string; weight?: number }>` | null, optional) — NEW per-season lens weights. Same create/update/clear semantics. Mutation post-`startedAt` is permitted.
- `format` (`{ questions: Array<{ label?, categories?, answersFormat?, questionType?, contexts? }> }` | null, optional) — per-season question composition with the slot shape extended per the "Per-season question format" requirement. Same create/update/clear semantics.

The tool SHALL:

1. Validate that `slug` is non-empty kebab-case.
2. Load the named game's `seasons.json` (initialize from scratch if missing).
3. If creating: require both `startedAt` and `expectedEndAt`. Categories source — if `categories` arg is provided AND non-empty, use exactly that list (deduped); otherwise copy the global `categories.json`. Reject if the resulting list is empty. Verify no-overlap invariant. Validate `answersFormat`, `questionType`, `contexts`, `format` per their respective invariants.
4. If updating: load the existing entry, apply the passed fields (omit-to-keep semantics; explicit `null` for `answersFormat` / `questionType` / `contexts` / `format` clears the respective field), re-validate, and reject any attempt to mutate `startedAt` of an already-started season.
5. Atomically write the new `games/<game>/seasons.json`.

Return shape: `{ game, slug, action: "created" | "updated", startedAt, expectedEndAt, endedAt, categoriesCount, hasAnswersFormat, hasQuestionType, hasContexts, hasFormat, slotCount }`. `slotCount` is `format.questions.length` when `hasFormat`, else `0`.

#### Scenario: Create a future season with format

- **GIVEN** `games/main/seasons.json` contains only the active "may-2026" season
- **WHEN** `upsert_season` is called with `game: "main", slug: "june-2026", startedAt: <June 1>, expectedEndAt: <June 30>, format: { questions: [{ label: "GK Boolean" }, { label: "History Choice", answersFormat: { boolean: 0, choice: 1 }, categories: ["History"] }] }`
- **THEN** the response is `{ game: "main", slug: "june-2026", action: "created", hasFormat: true, slotCount: 2, ... }`
- **AND** the new entry carries the provided `format` verbatim

#### Scenario: Update a season's format mid-season

- **GIVEN** the active "may-2026" season has `startedAt <= now` and a 1-slot format
- **WHEN** `upsert_season(game: "main", slug: "may-2026", { format: { questions: [{ label: "A" }, { label: "B" }] } })` is called
- **THEN** the response is `{ game: "main", slug: "may-2026", action: "updated", hasFormat: true, slotCount: 2, ... }`
- **AND** the entry's `format` is the new 2-slot definition

#### Scenario: Clear a season's format by passing null

- **GIVEN** the active "may-2026" has a `format` with 3 slots
- **WHEN** `upsert_season(game: "main", slug: "may-2026", { format: null })` is called
- **THEN** the entry's `format` field is removed
- **AND** the response carries `hasFormat: false, slotCount: 0`

#### Scenario: Create a future season with answersFormat within a game

- **WHEN** `upsert_season` is called with `game: "main", slug: "june-2026", startedAt: <June 1>, expectedEndAt: <June 30>, answersFormat: { "boolean": 2, "choice": 1 }`
- **THEN** the response is `{ game: "main", slug: "june-2026", action: "created", hasAnswersFormat: true, ... }`
- **AND** the new entry carries `answersFormat: { "boolean": 2, "choice": 1 }`

#### Scenario: Create a future season with questionType weights

- **WHEN** `upsert_season` is called with `game: "main", slug: "news-week", startedAt: <T>, expectedEndAt: <T+7d>, questionType: { "fact": 1, "topical": 3 }`
- **THEN** the response carries `hasQuestionType: true`
- **AND** the new entry carries `questionType: { "fact": 1, "topical": 3 }`

#### Scenario: Create a future season with contexts

- **WHEN** `upsert_season` is called with `game: "actu-qc", slug: "spring-2026", startedAt: <T>, expectedEndAt: <T+30d>, contexts: [{ name: "Quebec", weight: 5 }, { name: "International", weight: 1 }]`
- **THEN** the response carries `hasContexts: true`
- **AND** the new entry carries `contexts` verbatim

#### Scenario: Update a season's questionType mid-season

- **GIVEN** the active "may-2026" season has `startedAt <= now` and `questionType: { fact: 1 }`
- **WHEN** `upsert_season(game: "main", slug: "may-2026", { questionType: { topical: 1 } })` is called
- **THEN** the response is `{ action: "updated", hasQuestionType: true, ... }`
- **AND** the entry's `questionType` is now `{ topical: 1 }`
- **AND** the next `get_ideas` call rolls only `"topical"`

#### Scenario: Clear a season's contexts by passing null

- **GIVEN** the active "may-2026" has `contexts: [{ name: "Quebec" }]`
- **WHEN** `upsert_season(game: "main", slug: "may-2026", { contexts: null })` is called
- **THEN** the entry's `contexts` field is removed
- **AND** subsequent `get_ideas` calls fall back to `config.trivia.contexts` (or omit `contextPriority` entirely if not configured there either)

#### Scenario: Create a themed future season (categories replace baseline)

- **WHEN** `upsert_season` is called with `game: "main", slug: "june-2026", categories: ["Cephalopods", "Coral Reefs", "Tides"]`
- **THEN** the new entry's `categories` is exactly the provided list (no baseline mixing)

#### Scenario: Create a non-themed season (omit categories → copy baseline)

- **GIVEN** the global `categories.json` contains 50 baseline entries
- **WHEN** `upsert_season` is called with `game: "main"` as a create with no `categories` arg
- **THEN** the new entry's `categories` is a copy of the global `categories.json`

#### Scenario: Provided categories are deduped

- **WHEN** `upsert_season(... categories: ["Cephalopods", "Cephalopods", "Tides"])` is called
- **THEN** the resulting entry's `categories` is `["Cephalopods", "Tides"]`

#### Scenario: Update a future season's expected end

- **GIVEN** a future "june-2026" season with `expectedEndAt: June-30`
- **WHEN** `upsert_season` is called with `slug: "june-2026", expectedEndAt: <July 7>`
- **THEN** the entry's `expectedEndAt` is updated

#### Scenario: Update an existing season's endedAt (mark closed)

- **WHEN** `upsert_season` is called with `slug: "may-2026", endedAt: <now>`
- **THEN** the entry's `endedAt` is set

#### Scenario: Overlap rejection on update (within a game)

- **WHEN** an update would shift one season's window into another season's window in the same game
- **THEN** the call is rejected with an overlap error

#### Scenario: Cannot mutate startedAt of an already-started season

- **WHEN** `upsert_season(slug: <currently-active-or-past>, { startedAt: <new value> })` is called
- **THEN** the call is rejected with a "cannot shift the past" error

#### Scenario: Empty resulting pool rejected on create

- **WHEN** create-time categories resolution yields an empty list
- **THEN** the call is rejected with a "season must have at least one category" error

#### Scenario: Unknown game rejected

- **WHEN** `upsert_season` is called with an unknown game
- **THEN** the tool returns a structured "unknown game" error

#### Scenario: Disabled game refuses upsert

- **WHEN** `upsert_season` is called with a disabled game
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

- **WHEN** `upsert_season` is called with a malformed slug (spaces, uppercase, empty)
- **THEN** the call is rejected with a slug-format error

#### Scenario: Tool is gated to admin

- **WHEN** a session's user has role below `admin`
- **THEN** `upsert_season` is absent from the session's MCP catalog

### Requirement: Per-season question format

When `seasons.enabled` is `true`, the Trivia plugin SHALL accept an optional `format` field on each season entry. When present, the field MUST conform to:

```
format: {
  questions: Array<{
    label?: string,
    categories?: string[],
    answersFormat?: Record<"boolean" | "choice", number>,
    questionType?: Record<"fact" | "topical", number>,
    contexts?: Array<{ name: string; weight?: number }>
  }>
}
```

Invariants:

1. `format.questions` MUST be a non-empty array.
2. Each slot's `label`, when present, MUST be a non-empty string after trim.
3. Each slot's `categories`, when present, MUST be a non-empty array of strings (deduped, preserving first-occurrence order).
4. Each slot's `answersFormat`, when present, MUST contain only the keys `"boolean"` and `"choice"`, each mapped to a non-negative integer, AND at least one key MUST be mapped to a strictly positive value.
5. Each slot's `questionType`, when present, MUST contain only the keys `"fact"` and `"topical"`, with the same positive-weight invariant.
6. Each slot's `contexts`, when present, MUST be a non-empty array with the same name/weight invariants as the season-level `contexts`.
7. All slot fields are optional individually; an entirely empty slot (`{}`) is permitted and means "use season defaults for everything".

When a season's `format` is absent, the season SHALL behave as before this change: each question-cron fire posts a single question rolled from the season's `categories`, `answersFormat`, `questionType`, and `contexts`.

When a season's `format` is present, each question-cron fire SHALL post `format.questions.length` questions (one per slot, in array order).

#### Scenario: Season without format behaves as before

- **GIVEN** a season entry with no `format` field
- **WHEN** the question cron fires
- **THEN** a single question is posted using the season's `categories`, `answersFormat`, `questionType`, and `contexts` resolutions

#### Scenario: Season with format posts one question per slot

- **GIVEN** a season entry with `format: { questions: [{ label: "GK 1" }, { label: "History Choice", answersFormat: { boolean: 0, choice: 1 } }] }`
- **WHEN** the question cron fires
- **THEN** exactly two questions are posted in that order

#### Scenario: Slot can override questionType

- **GIVEN** a season with `questionType: { fact: 1 }` and `format: { questions: [{}, { questionType: { topical: 1 } }] }`
- **WHEN** `get_ideas` is called with `slot: 1`
- **THEN** `suggestedQuestionType` is always `"topical"`

#### Scenario: Slot can override contexts

- **GIVEN** a season with `contexts: [{ name: "Quebec" }]` and `format: { questions: [{ contexts: [{ name: "academic" }] }] }`
- **WHEN** `get_ideas` is called with `slot: 0`
- **THEN** `contextPriority` is `["academic"]`

#### Scenario: Empty questions array rejected on write

- **WHEN** `upsert_season` is called with `format: { questions: [] }`
- **THEN** the call is rejected

#### Scenario: Invalid slot.answersFormat rejected

- **WHEN** `upsert_season` is called with `format: { questions: [{ answersFormat: { boolean: 0, choice: 0 } }] }`
- **THEN** the call is rejected with an "answersFormat must have at least one positive weight" error

#### Scenario: Invalid slot.questionType rejected

- **WHEN** `upsert_season` is called with `format: { questions: [{ questionType: { fact: 0, topical: 0 } }] }`
- **THEN** the call is rejected with a "questionType must have at least one positive weight" error

#### Scenario: Empty slot is permitted

- **WHEN** `upsert_season` is called with `format: { questions: [{}] }`
- **THEN** the call succeeds; the slot inherits all defaults from the season at posting time

### Requirement: save_question slot binding

When the active season has a `format`, the `save_question` MCP tool SHALL require a `slot: { index: number, label?: string }` argument. The tool SHALL:

1. Reject the call with a structured "slot required" error if `slot` is omitted.
2. Reject the call with a structured "slot index out of range" error if `slot.index` is not in `[0, format.questions.length)`.
3. Resolve the slot's effective `answersFormat` via the cascade `slot.answersFormat ?? season.answersFormat ?? config.trivia.answersFormat` and reject the call with an "answers format not permitted by slot" error if the question's actual `answersFormat` value is not in the slot's permitted set (weight > 0).
4. Resolve the slot's effective `questionType` via the cascade `slot.questionType ?? season.questionType ?? config.trivia.questionType` and reject the call with a "question type not permitted by slot" error if the question's actual `questionType` value is not in the slot's permitted set (weight > 0).
5. Resolve the slot's effective `categories` via the cascade `slot.categories ?? season.categories` and reject the call with a "category not in slot pool" error if the question's `category` is not in that resolved pool.
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

#### Scenario: Context not in slot's lens list

- **GIVEN** a season's slot 0 has `contexts: [{ name: "Quebec" }]`
- **WHEN** `save_question` is called with `slot: { index: 0 }, context: "International"`
- **THEN** the call is rejected with a "context not in slot lens list" error

#### Scenario: Slot argument rejected when season has no format

- **GIVEN** the active season has no `format`
- **WHEN** `save_question` is called with any `slot` argument
- **THEN** the call is rejected with a "season has no format" error
