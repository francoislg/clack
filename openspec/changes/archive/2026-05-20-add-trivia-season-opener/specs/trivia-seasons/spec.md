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
    "theme": string?,                        // NEW — OPTIONAL short human-readable narrative label (e.g. "Halloween Spooktacular").
                                             // Trimmed string; omitted/absent when no theme is configured. Surfaced by get_ideas
                                             // and the question-posting opener; never inferred from other fields.
    "categories": string[],                  // the season's category pool (non-empty)
    "answersFormat": Record<"boolean" | "choice", number>?
                                             // OPTIONAL per-season answers-format weights; renamed from "questionTypes" pre-change.
                                             // When absent, get_ideas falls back to config.trivia.answersFormat.
    "questionType": Record<"fact" | "topical", number>?
                                             // OPTIONAL per-season question-type weights (fact vs topical).
                                             // When absent, get_ideas falls back to config.trivia.questionType.
    "contexts": Array<{ name: string; weight?: number }>?
                                             // OPTIONAL per-season lens weights for the contexts axis.
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
9. When present, each entry's `theme` SHALL be a non-empty trimmed string. An empty-after-trim value SHALL be rejected by `upsert_season` (callers should pass `null` to clear instead).

Per-game `seasons.json` files SHALL be created lazily — when any tool resolves `game = "X"` and finds no `games/X/seasons.json` while `trivia.seasons.enabled` is `true`, the plugin SHALL seed a starter season into that file before continuing. The starter entry's `slug` is `season-YYYY-MM` (current UTC month), `startedAt` is `Date.now()`, `expectedEndAt` is end-of-current-UTC-month, and `categories` is a copy of the global `categories.json`. The starter entry SHALL NOT carry a `format`, `answersFormat`, `questionType`, `contexts`, or `theme` field.

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
- **AND** the entry has no `answersFormat`, `questionType`, `contexts`, `theme`, or `format` field

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

### Requirement: upsert_season tool

When `seasons.enabled` is `true`, the Trivia plugin SHALL expose an `upsert_season` MCP tool gated to the `admin` role that creates a new season or updates an existing one within a specified game.

The tool SHALL accept a required `game: string` argument; the slug SHALL be validated against `config.trivia.games[]` per the `trivia-games` capability (unknown slug → structured "unknown game" error; `enabled: false` entry → structured "game is disabled" error, since upsert is a write).

The tool SHALL further accept:

- `slug` (string, required) — non-empty kebab-case identifier. Treated as immutable: if the slug already exists _within the named game's timeline_, the call is an update of that entry; otherwise the call creates a new entry. Slug renaming is not supported. Slugs may collide with slugs in other games' timelines without issue.
- `startedAt` (number, optional, unix-ms) — required on CREATE; on UPDATE, modifying it is rejected if the existing entry's `startedAt <= now`.
- `expectedEndAt` (number, optional, unix-ms) — required on CREATE; on UPDATE, the new value MUST still satisfy `startedAt < (endedAt ?? newExpectedEndAt)`.
- `endedAt` (number, optional, unix-ms) — sets the actual end time.
- `categories` (string[], optional) — the season's category pool. Replace-or-baseline semantics on CREATE; ignored on UPDATE.
- `theme` (string | null, optional) — NEW per-season human-readable narrative label. On CREATE, when provided as a non-empty trimmed string, stored verbatim; omitted leaves the season theme-less. On UPDATE, an object/string value replaces the entry's existing `theme`; explicit `null` clears the field; omission preserves the existing value. Empty / whitespace-only strings are rejected on both CREATE and UPDATE.
- `answersFormat` (`Record<"boolean" | "choice", number>` | null, optional) — per-season answers-format weights (renamed from `questionTypes`). On CREATE, stored verbatim. On UPDATE, an object value replaces the entry's existing `answersFormat`; explicit `null` clears the field. Mutation post-`startedAt` is permitted.
- `questionType` (`Record<"fact" | "topical", number>` | null, optional) — per-season fact/topical weights. Same create/update/clear semantics as `answersFormat`. Mutation post-`startedAt` is permitted.
- `contexts` (`Array<{ name: string; weight?: number }>` | null, optional) — per-season lens weights. Same create/update/clear semantics. Mutation post-`startedAt` is permitted.
- `format` (`{ questions: Array<{ label?, categories?, answersFormat?, questionType?, contexts? }> }` | null, optional) — per-season question composition with the slot shape extended per the "Per-season question format" requirement. Same create/update/clear semantics.

The tool SHALL:

1. Validate that `slug` is non-empty kebab-case.
2. Load the named game's `seasons.json` (initialize from scratch if missing).
3. If creating: require both `startedAt` and `expectedEndAt`. Categories source — if `categories` arg is provided AND non-empty, use exactly that list (deduped); otherwise copy the global `categories.json`. Reject if the resulting list is empty. Validate `theme` (when provided) is a non-empty trimmed string. Verify no-overlap invariant. Validate `answersFormat`, `questionType`, `contexts`, `format` per their respective invariants.
4. If updating: load the existing entry, apply the passed fields (omit-to-keep semantics; explicit `null` for `theme` / `answersFormat` / `questionType` / `contexts` / `format` clears the respective field), re-validate, and reject any attempt to mutate `startedAt` of an already-started season.
5. Atomically write the new `games/<game>/seasons.json`.

Return shape: `{ game, slug, action: "created" | "updated", startedAt, expectedEndAt, endedAt, categoriesCount, hasTheme, hasAnswersFormat, hasQuestionType, hasContexts, hasFormat, slotCount }`. `slotCount` is `format.questions.length` when `hasFormat`, else `0`. `hasTheme` is `true` iff the resulting entry has a non-empty `theme` string.

#### Scenario: Create a future season with format

- **GIVEN** `games/main/seasons.json` contains only the active "may-2026" season
- **WHEN** `upsert_season` is called with `game: "main", slug: "june-2026", startedAt: <June 1>, expectedEndAt: <June 30>, format: { questions: [{ label: "GK Boolean" }, { label: "History Choice", answersFormat: { boolean: 0, choice: 1 }, categories: ["History"] }] }`
- **THEN** the response is `{ game: "main", slug: "june-2026", action: "created", hasFormat: true, slotCount: 2, hasTheme: false, ... }`
- **AND** the new entry carries the provided `format` verbatim
- **AND** the new entry has no `theme` field

#### Scenario: Update a season's format mid-season

- **GIVEN** the active "may-2026" season has `startedAt <= now` and a 1-slot format
- **WHEN** `upsert_season(game: "main", slug: "may-2026", { format: { questions: [{ label: "A" }, { label: "B" }] } })` is called
- **THEN** the response is `{ game: "main", slug: "may-2026", action: "updated", hasFormat: true, slotCount: 2, ... }`
- **AND** the entry's `format` is the new 2-slot definition

#### Scenario: Clear a season's format by passing null

- **GIVEN** the active "may-2026" has `format` with 3 slots
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

#### Scenario: Create a future season with a theme

- **WHEN** `upsert_season` is called with `game: "main", slug: "halloween-2026", startedAt: <Oct 1>, expectedEndAt: <Oct 31>, theme: "Halloween Spooktacular"`
- **THEN** the response carries `action: "created", hasTheme: true`
- **AND** the new entry's `theme` is `"Halloween Spooktacular"`

#### Scenario: Add a theme to an existing season

- **GIVEN** the active "may-2026" season has no `theme` field
- **WHEN** `upsert_season(game: "main", slug: "may-2026", { theme: "Music Mayhem" })` is called
- **THEN** the response carries `action: "updated", hasTheme: true`
- **AND** the entry's `theme` is `"Music Mayhem"`

#### Scenario: Clear a season's theme by passing null

- **GIVEN** the active "may-2026" season has `theme: "Music Mayhem"`
- **WHEN** `upsert_season(game: "main", slug: "may-2026", { theme: null })` is called
- **THEN** the entry's `theme` field is removed
- **AND** the response carries `hasTheme: false`

#### Scenario: Omitting theme on update preserves the existing value

- **GIVEN** the active "may-2026" season has `theme: "Music Mayhem"`
- **WHEN** `upsert_season(game: "main", slug: "may-2026", { expectedEndAt: <T+1d> })` is called (no `theme` field on the call)
- **THEN** the entry's `theme` remains `"Music Mayhem"` unchanged

#### Scenario: Mid-season theme edit does not retroactively re-trigger an opener

- **GIVEN** the active "may-2026" season has been live for 5 days and 5 questions have been posted (each stamped with `season: "may-2026"`)
- **WHEN** `upsert_season(game: "main", slug: "may-2026", { theme: "Music Mayhem" })` is called
- **THEN** subsequent `get_ideas` calls return `firstFireOfSeason: false` and `theme: "Music Mayhem"`
- **AND** no second opener is rendered on the next question-cron fire

## ADDED Requirements

### Requirement: Continuation seasons created by rollover leave theme undefined

When `applySeasonRollover` automatically creates a continuation `season-YYYY-MM` because no future season was queued at the moment the previous season ended, the continuation entry's `theme` field SHALL be left undefined — independent of whether the closing season had a `theme` set.

Admins who want a continuing theme on the next season SHALL pre-stage that next season via `upsert_season` with the desired `theme` before the rollover fires. The automatic continuation path is deliberately theme-less: themes are narrative choices, not inheritable schedule settings.

#### Scenario: Closing season's theme is not inherited by the auto-continuation

- **GIVEN** `games/main/seasons.json`'s active "october-2026" season has `theme: "Halloween Spooktacular"` and no future season is queued
- **WHEN** the reveal-cron fires `process_reveal_answers` at `isLastFireOfSeason: true` and `applySeasonRollover` creates a continuation `season-2026-11`
- **THEN** the new `season-2026-11` entry has no `theme` field
- **AND** the next question-cron fire on that continuation season renders an opener with no theme line

#### Scenario: Pre-staged continuation season can carry its own theme

- **GIVEN** `games/main/seasons.json`'s active "october-2026" season has `theme: "Halloween Spooktacular"`
- **AND** an admin has pre-staged "november-2026" via `upsert_season` with `theme: "Movember Marathon"`
- **WHEN** rollover fires
- **THEN** no auto-continuation is created (a future season is already queued)
- **AND** the next question-cron fire on "november-2026" renders an opener mentioning "Movember Marathon"
