# Trivia Seasons

## Purpose

Optional competitive "chapters" for the Trivia plugin, modeled as a **timeline of seasons** scoped per-game. When enabled via `config.trivia.seasons`, the plugin maintains a `seasons.json` inside each game's directory (`data/plugins/trivia/games/<name>/seasons.json`) as a flat array of non-overlapping season intervals; "current" is a derived query against `now`. Every newly-written question/answer/cheat record is tagged with the active season's slug for its game (or omitted in a gap). The reveal flow renders a 3-row Current/All-Time leaderboard and, on the season's last fire, a wrap-up finale before rolling the timeline forward via `upsert_season`. Multiple future seasons can coexist as prepared drafts per game; admins refine their dates, names, and category pools before they go live. When disabled, the plugin writes no season tags.
## Requirements
### Requirement: SeasonEntry and SeasonFormatSlot carry promptMedium cascade fields

`SeasonEntry` SHALL accept an optional `promptMedium?: Record<"text" | "image", number>` field alongside the existing `answersFormat` / `questionType` / `contexts` cascade fields. `SeasonFormatSlot` SHALL accept the same optional `promptMedium` field for per-slot override.

The cascade resolution order SHALL be `slot → season → config → default { text: 1, image: 0 }`, matching the established pattern for other axes. Mid-season mutation SHALL be permitted (same semantics as `answersFormat` and `questionType` — changes take effect on the next question-cron fire).

#### Scenario: Season-level promptMedium overrides config

- **GIVEN** `config.trivia.promptMedium: { text: 1, image: 0 }`
- **AND** the active season's `promptMedium: { text: 1, image: 2 }`
- **WHEN** `get_ideas` rolls many times during that season
- **THEN** roughly 2/3 of rolls yield `suggestedPromptMedium: "image"` (subject to weight semantics)

#### Scenario: Slot-level promptMedium overrides season

- **GIVEN** the active season's `promptMedium: { text: 1, image: 0 }`
- **AND** slot 1's `promptMedium: { text: 0, image: 1 }`
- **WHEN** `get_ideas({ slot: 1 })` is called
- **THEN** `suggestedPromptMedium` is always `"image"` (slot wins)

#### Scenario: Mid-season promptMedium mutation takes effect on next fire

- **GIVEN** an active season was created with `promptMedium: { text: 1, image: 0 }`
- **WHEN** an admin calls `upsert_season` to set `promptMedium: { text: 0, image: 1 }`
- **AND** the next question-cron fire runs
- **THEN** `get_ideas` for that fire returns `suggestedPromptMedium: "image"`

### Requirement: upsert_season accepts promptMedium argument

The `upsert_season` MCP tool SHALL accept optional `promptMedium` weights at both the season-entry level and (when `format` is provided) the per-slot level. The tool SHALL validate `promptMedium` the same way `config.trivia.promptMedium` is validated:

- Only keys `"text"` and `"image"` permitted.
- Non-negative integer weights.
- At least one positive weight (all-zero maps rejected).

#### Scenario: Upsert season with image-only promptMedium

- **WHEN** `upsert_season` is called with `promptMedium: { text: 0, image: 1 }`
- **THEN** the persisted season entry carries that promptMedium and subsequent `get_ideas` rolls for that season yield `suggestedPromptMedium: "image"`

#### Scenario: Upsert season with per-slot promptMedium

- **WHEN** `upsert_season` is called with a `format` containing slots whose `promptMedium` weights differ
- **THEN** each slot's `promptMedium` is persisted and applied independently on the next fire

#### Scenario: Invalid promptMedium rejected

- **WHEN** `upsert_season` is called with `promptMedium: { text: 0, image: 0 }`
- **THEN** the tool returns an error explaining that at least one positive weight is required

### Requirement: liveAnswersVisible on season and slot

`SeasonEntry` and each slot entry within `SeasonFormat.questions[]` SHALL accept an optional `liveAnswersVisible: boolean` field. When present, these values participate in the `liveAnswersVisible` cascade resolved at `post_questions` time:

```
slot.liveAnswersVisible          (highest precedence — within SeasonFormat.questions[i])
  → season.liveAnswersVisible    (on SeasonEntry)
    → game.liveAnswersVisible    (on TriviaGame, per trivia-games spec)
      → config.trivia.liveAnswersVisible (workspace level)
        → true (default)
```

The fields SHALL be parsed by the seasons-state loader and the `upsert_season` MCP tool with the following rules:

- Absence at any tier is valid — the cascade falls through.
- Non-boolean values SHALL be rejected on `upsert_season` write attempts with a structured error.
- Explicit `null` on `upsert_season` SHALL clear the field (same convention as `theme`, `answersFormat`, `questionType`, `contexts`, `format`). Omitting the field on UPDATE leaves the existing value intact.
- Mutation post-`startedAt` is permitted — the cascade resolves at post-time per question, and questions already posted are stamped with the value resolved AT post-time, so mid-season edits do not affect already-posted questions.

`upsert_season`'s return shape SHALL include `hasLiveAnswersVisible: boolean` (true iff the resulting entry has an explicit value).

`list_seasons` SHALL surface per-season `liveAnswersVisible` and per-slot `liveAnswersVisible` when set.

#### Scenario: Season-level value resolves through cascade

- **GIVEN** a season entry with `liveAnswersVisible: false`, no slot override, game default-absent, workspace default-true
- **WHEN** `post_questions` posts a question into this season
- **THEN** the stamped value is `false`

#### Scenario: Slot-level value beats season

- **GIVEN** a season with `liveAnswersVisible: false` and a 2-slot format where `questions[1]` has `liveAnswersVisible: true`
- **WHEN** `post_questions` posts the slot-1 question
- **THEN** the stamped value is `true` (slot wins)

#### Scenario: upsert_season creates a season with the field

- **WHEN** `upsert_season(game: "main", slug: "june-2026", startedAt: <T>, expectedEndAt: <T'>, liveAnswersVisible: false)` is called
- **THEN** the season is created with `liveAnswersVisible: false`
- **AND** the response carries `hasLiveAnswersVisible: true`

#### Scenario: upsert_season clears the field with null

- **GIVEN** an existing season with `liveAnswersVisible: false`
- **WHEN** `upsert_season(game, slug, { liveAnswersVisible: null })` is called
- **THEN** the field is removed from the entry
- **AND** the response carries `hasLiveAnswersVisible: false`

#### Scenario: Non-boolean value rejected on upsert

- **WHEN** `upsert_season(game, slug, { liveAnswersVisible: "false" })` is called (string, not boolean)
- **THEN** the call is rejected with a structured "liveAnswersVisible must be boolean" error
- **AND** no write occurs

#### Scenario: Mid-season edit does not affect already-posted questions

- **GIVEN** `Q1` was posted yesterday with stamped `liveAnswersVisible: true`
- **WHEN** an admin updates the season's `liveAnswersVisible` to `false` today
- **AND** a user clicks a vote button on `Q1` today
- **THEN** `Q1`'s roster footer rebuilds in visible mode (per its stamped value)
- **AND** a NEW question posted today receives the new `false` value

#### Scenario: Slot-level field accepted on upsert_season

- **WHEN** `upsert_season(game, slug, { format: { questions: [{ label: "A", liveAnswersVisible: false }, { label: "B" }] } })` is called
- **THEN** the season is written with slot 0 carrying `liveAnswersVisible: false` and slot 1 with no override
- **AND** `list_seasons` shows the slot-0 override but not slot-1

### Requirement: revealResponses on season and slot

`SeasonEntry` and each slot entry within `SeasonFormat.questions[]` SHALL accept an optional `revealResponses: "no" | "just-correctness" | "yes"` field. When present, these values participate in the `revealResponses` cascade resolved at `post_questions` time:

```
slot.revealResponses          (highest precedence — within SeasonFormat.questions[i])
  → season.revealResponses    (on SeasonEntry)
    → game.revealResponses    (on TriviaGame, per trivia-games spec)
      → config.trivia.revealResponses (workspace level)
        → "yes" (default)
```

The fields SHALL be parsed by the seasons-state loader and the `upsert_season` MCP tool with the following rules:

- Absence at any tier is valid — the cascade falls through.
- Values other than the three string literals SHALL be rejected on `upsert_season` write attempts with a structured error.
- Explicit `null` on `upsert_season` SHALL clear the field. Omitting the field on UPDATE leaves the existing value intact.
- Mutation post-`startedAt` is permitted — the cascade resolves at post-time per question.

`upsert_season`'s return shape SHALL include `hasRevealResponses: boolean` (true iff the resulting entry has an explicit value).

`list_seasons` SHALL surface per-season `revealResponses` and per-slot `revealResponses` when set.

#### Scenario: Season-level value resolves through cascade

- **GIVEN** a season entry with `revealResponses: "just-correctness"`, no slot override, game default-absent, workspace default-"yes"
- **WHEN** `post_questions` posts a question into this season
- **THEN** the stamped value is `"just-correctness"`

#### Scenario: Slot-level value beats season

- **GIVEN** a season with `revealResponses: "no"` and a 2-slot format where `questions[1]` has `revealResponses: "yes"`
- **WHEN** `post_questions` posts the slot-1 question
- **THEN** the stamped value is `"yes"` (slot wins)

#### Scenario: upsert_season creates a season with revealResponses

- **WHEN** `upsert_season(game: "main", slug: "june-2026", startedAt: <T>, expectedEndAt: <T'>, revealResponses: "no")` is called
- **THEN** the season is created with `revealResponses: "no"`
- **AND** the response carries `hasRevealResponses: true`

#### Scenario: upsert_season clears revealResponses with null

- **GIVEN** an existing season with `revealResponses: "no"`
- **WHEN** `upsert_season(game, slug, { revealResponses: null })` is called
- **THEN** the field is removed from the entry
- **AND** the response carries `hasRevealResponses: false`

#### Scenario: Invalid revealResponses string rejected on upsert

- **WHEN** `upsert_season(game, slug, { revealResponses: "maybe" })` is called
- **THEN** the call is rejected with a structured error
- **AND** no write occurs

#### Scenario: Non-string revealResponses rejected on upsert

- **WHEN** `upsert_season(game, slug, { revealResponses: false })` is called
- **THEN** the call is rejected with a structured "revealResponses must be one of \"no\", \"just-correctness\", \"yes\"" error

#### Scenario: Slot-level revealResponses accepted on upsert_season

- **WHEN** `upsert_season(game, slug, { format: { questions: [{ label: "A", revealResponses: "no" }, { label: "B" }] } })` is called
- **THEN** the season is written with slot 0 carrying `revealResponses: "no"` and slot 1 with no override
- **AND** `list_seasons` shows the slot-0 override but not slot-1

### Requirement: Seasons configuration block

The Trivia plugin SHALL accept an optional `seasons` configuration block at `data/config.json` → `trivia.seasons` with two fields: `enabled` (boolean, default `false`) and `prompt` (string, required when `enabled` is `true`). When `enabled` is `false` or the block is absent, the plugin SHALL behave as it did before this change in every observable respect — no `season` field is written on new records, no per-game `seasons.json` file is created, none of the timeline tools (`check_season_status`, `upsert_season`, `delete_season`, `list_seasons`) appear in any session's MCP catalog, `retrieve_scores` returns only cumulative totals, the reveal leaderboard renders as two rows, and the reveal flow includes no season-finale section.

When `enabled` is `true`, the plugin SHALL load the `prompt` string at startup and pass it into the system prompt context for any session whose tools include `upsert_season`, so Claude has the cadence/style guidance available when deriving a new season's `slug`, `expectedEndAt`, and (when themed) `categories`.

#### Scenario: Seasons disabled by default

- **WHEN** `data/config.json` contains no `trivia.seasons` block
- **THEN** new question/answer/cheat records are written without a `season` field
- **AND** no per-game `seasons.json` is created
- **AND** sessions do not see `check_season_status`, `upsert_season`, `delete_season`, or `list_seasons` in their MCP catalog
- **AND** the leaderboard table at reveal time renders as two rows (names + scores)

#### Scenario: Seasons explicitly disabled

- **WHEN** `data/config.json` contains `trivia.seasons: { enabled: false }`
- **THEN** behavior is identical to the "absent block" case above

#### Scenario: Seasons enabled requires a prompt

- **WHEN** `data/config.json` contains `trivia.seasons: { enabled: true }` with no `prompt` field
- **THEN** the plugin SHALL log a configuration error and SHALL refuse to register the timeline tools
- **AND** the rest of the plugin continues to load normally (seasons-off behavior)

#### Scenario: Seasons enabled with prompt

- **GIVEN** `data/config.json` contains `trivia.seasons: { enabled: true, prompt: "Every month" }`
- **WHEN** the plugin loads
- **THEN** `check_season_status`, `upsert_season`, `delete_season`, and `list_seasons` are registered with the MCP catalog
- **AND** the `prompt` string is available to Claude in sessions that include `upsert_season`

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

### Requirement: check_season_status tool

When `seasons.enabled` is `true`, the Trivia plugin SHALL expose a `check_season_status` MCP tool gated to the `admin` role.

The tool SHALL accept a required `game: string` argument, validated against `config.trivia.games[]` per the `trivia-games` capability. Read tool — succeeds against `enabled: false` games. The tool's analysis SHALL be scoped exclusively to `data/plugins/trivia/games/<game>/seasons.json` (lazy-seeded if missing).

The tool SHALL return:

- `currentSlug` (string | null) — the slug of the game's currently-active season per `findCurrentSeason(games/<game>/seasons.json, now)`, or `null` when `now` falls in a gap.
- `currentExpectedEndAt` (number | null) — the active season's `expectedEndAt`, or `null` when there is no current season.
- `isLastFireOfSeason` (boolean) — `true` if and only if there is a current season AND no further cron fire of the trivia reveal schedule (for this game) is scheduled on or before `currentExpectedEndAt` after `now`.
- `nextSeasonSlug` (string | null) — the slug of the season in this game with the smallest `startedAt` strictly greater than the current's `expectedEndAt`, or `null` if no future season is queued for this game.
- `nextSeasonStartsAt` (number | null) — the queued season's `startedAt`, or `null`.
- `isInGap` (boolean) — `true` when `currentSlug` is `null` because `now` falls between two seasons on this game's timeline (or after the last season).

#### Scenario: Mid-season reveal with no queued future season

- **GIVEN** `games/main/seasons.json` has one active season and no future seasons on its timeline
- **WHEN** `check_season_status` is called with `game: "main"` mid-season
- **THEN** `currentSlug` and `currentExpectedEndAt` reflect the active season
- **AND** `nextSeasonSlug` and `nextSeasonStartsAt` are `null`
- **AND** `isInGap` is `false`

#### Scenario: Mid-season reveal with a queued future season

- **GIVEN** `games/main/seasons.json`'s active "may-2026" season has `expectedEndAt: May-31` and the timeline also contains "june-2026" with `startedAt: June-1`
- **WHEN** `check_season_status` is called with `game: "main"` mid-May
- **THEN** `currentSlug` is `"may-2026"`
- **AND** `nextSeasonSlug` is `"june-2026"`
- **AND** `nextSeasonStartsAt` is `June-1`

#### Scenario: Call during a gap returns isInGap true

- **GIVEN** no season's active window in `games/main/seasons.json` contains `now`
- **WHEN** `check_season_status` is called with `game: "main"`
- **THEN** `currentSlug`, `currentExpectedEndAt`, `isLastFireOfSeason` are `null` / `false`
- **AND** `isInGap` is `true`
- **AND** `nextSeasonSlug` may still be set if a future season exists on this game's timeline

#### Scenario: Other games' timelines do not influence the result

- **GIVEN** `games/main/seasons.json` is in a gap but `games/sandbox/seasons.json` has an active season
- **WHEN** `check_season_status` is called with `game: "main"`
- **THEN** the response reflects only the `main` timeline (gap)
- **AND** the sandbox timeline does not leak into any field

#### Scenario: Unknown game rejected

- **WHEN** `check_season_status` is called with `game: "ghost"` (not in the registry)
- **THEN** the tool returns a structured "unknown game" error

#### Scenario: Tool is gated to admin

- **WHEN** a session's user has role below `admin`
- **THEN** `check_season_status` is absent from the session's MCP catalog

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
- `questionType` (`Record<"fact" | "topical", number>` | null, optional) — NEW per-season fact/topical weights. Same create/update/clear semantics as `answersFormat`. Mutation post-`startedAt` is permitted.
- `contexts` (`Array<{ name: string; weight?: number }>` | null, optional) — NEW per-season lens weights. Same create/update/clear semantics. Mutation post-`startedAt` is permitted.
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

#### Scenario: Cannot mutate startedAt of an already-started season

- **GIVEN** the active "may-2026" season in `games/main/seasons.json` has `startedAt: <April 24>` (in the past)
- **WHEN** `upsert_season(game: "main", slug: "may-2026", { startedAt: <April 26> })` is called
- **THEN** the call is rejected with a "cannot shift the past" error

#### Scenario: Empty resulting pool rejected on create

- **GIVEN** the global `categories.json` is empty AND `categories` arg is omitted (or empty)
- **WHEN** `upsert_season` is called with `game: "main"` as a create
- **THEN** the call is rejected with a "season must have at least one category" error

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

### Requirement: delete_season tool

When `seasons.enabled` is `true`, the Trivia plugin SHALL expose a `delete_season` MCP tool gated to the `admin` role that removes an entry from a specified game's seasons timeline.

The tool SHALL accept:

- `game` (string, required) — the game slug; validated against `config.trivia.games[]`. Unknown → "unknown game" error; disabled → "game is disabled" error (write tool).
- `slug` (string, required) — the slug of the season to delete within the named game.

The tool SHALL:

1. Reject the call if `slug` does not match any entry in the named game's `seasons.json` (404-style error).
2. Reject the call if the named entry's `startedAt <= now` (past and current seasons are immutable historical records).
3. Reject the call if the named entry is the only entry in the named game's timeline.
4. Otherwise, remove the named entry from `games/<game>/seasons.json#seasons`.

#### Scenario: Delete a not-yet-started future season

- **GIVEN** `games/main/seasons.json` contains active "may-2026" and queued "june-2026" `(startedAt: <June 1>, > now)`
- **WHEN** `delete_season(game: "main", slug: "june-2026")` is called
- **THEN** the call succeeds; `games/main/seasons.json#seasons` no longer contains "june-2026"

#### Scenario: Cannot delete the current season

- **GIVEN** the active "may-2026" season in `games/main/seasons.json` has `startedAt <= now`
- **WHEN** `delete_season(game: "main", slug: "may-2026")` is called
- **THEN** the call is rejected with a "season has already started" error

#### Scenario: Cannot delete a past season

- **GIVEN** `games/main/seasons.json` contains an old "spring-2026" entry with `endedAt < now`
- **WHEN** `delete_season(game: "main", slug: "spring-2026")` is called
- **THEN** the call is rejected with a "season has already started" error

#### Scenario: Cannot delete the only season in a game

- **GIVEN** `games/main/seasons.json` contains exactly one entry
- **WHEN** `delete_season(game: "main", slug: <that slug>)` is called
- **THEN** the call is rejected with a "cannot delete the only season" error

#### Scenario: Unknown game rejected

- **WHEN** `delete_season` is called with `game: "ghost"`
- **THEN** the tool returns a structured "unknown game" error

#### Scenario: Tool is gated to admin

- **WHEN** a session's user has role below `admin`
- **THEN** `delete_season` is absent from the session's MCP catalog

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
    categories: string[],
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

The `theme`, `answersFormat`, `questionType`, `freeformAnswerShape`, `contexts`, `difficulty`, `difficultyRatio`, and `format` fields SHALL be present on a season entry IF AND ONLY IF the season's stored record carries an explicit value for that field. Absent fields signal that the season relies on the next tier of the cascade (workspace defaults or built-in fallback). Slot entries inside `format.questions` follow the same rule — each slot-tier field is present only when the slot literally set it.

Entries SHALL be returned in their stored order. The full `categories` array is included for every entry. The tool's description SHALL explicitly state the cascade rule (slot → season → workspace → built-in default) and point Claude at `list_games` for the workspace tier, so the response can be reasoned about without out-of-band knowledge.

#### Scenario: Returns every timeline entry for the named game with status flags

- **GIVEN** `games/main/seasons.json` contains a past season, the active season, and a queued future season
- **WHEN** `list_seasons` is invoked with `game: "main"`
- **THEN** the response includes all three entries from the `main` timeline
- **AND** the past entry's `status` is `"past"`
- **AND** the active entry's `status` is `"current"`
- **AND** the future entry's `status` is `"future"`
- **AND** each entry includes its full `categories` array
- **AND** no entries from `games/sandbox/seasons.json` appear in the response

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

#### Scenario: Unknown game rejected

- **WHEN** `list_seasons` is called with `game: "ghost"`
- **THEN** the tool returns a structured "unknown game" error

#### Scenario: Tool is gated to admin

- **WHEN** a session's user has role below `admin`
- **THEN** `list_seasons` is absent from the session's MCP catalog

### Requirement: Season tag on new records

When `seasons.enabled` is `true` AND `findCurrentSeason(games/<game>/seasons.json, now)` returns a season, the Trivia plugin SHALL stamp `season: <currentSlug>` onto every newly-written record in that game's `questions.json`, `answers.json`, and `cheats.json`. The `season` value SHALL be captured at the moment of write, so a record stamped during one season remains tagged with that slug even after the season has rolled over.

When the active season has a `format`, the Trivia plugin SHALL additionally stamp `slot: { index: number, label?: string }` onto every newly-written record in that game's `questions.json`. The `index` SHALL be the slot index supplied to `save_question`. The `label` SHALL be snapshotted from `format.questions[index].label` at write time (omitted when the slot has no label). The `slot` field SHALL NOT be present on `answers.json` or `cheats.json` records — those records carry game-level participation, not slot-level.

When the active season has no `format`, no `slot` field SHALL be present on any new record.

When `findCurrentSeason` returns `null` (timeline gap) for the game's timeline, new records in that game's files SHALL NOT carry a `season` field. Slot stamping is also suppressed in this case (no active season ⇒ no active format).

The global `users.json` and `categories.json` SHALL NOT carry a `season` field — users and categories span seasons by design.

#### Scenario: save_question stamps season from the named game's timeline

- **GIVEN** the active season in `games/main/seasons.json` is `"may-2026"`
- **AND** the active season in `games/sandbox/seasons.json` is `"sandbox-launch"`
- **WHEN** `save_question` is called with `game: "main"` and valid arguments
- **THEN** the new entry in `games/main/questions.json` includes `season: "may-2026"`
- **AND** the entry does NOT include `season: "sandbox-launch"`

#### Scenario: save_question stamps slot when active season has a format

- **GIVEN** the active season has `format: { questions: [{ label: "GK 1" }, { label: "History Choice" }] }`
- **WHEN** `save_question` is called with `slot: { index: 1 }` and valid arguments
- **THEN** the new entry in `games/main/questions.json` includes `slot: { index: 1, label: "History Choice" }`
- **AND** the snapshotted label comes from `format.questions[1].label`, not the caller's `slot.label`

#### Scenario: save_question does not stamp slot when no format

- **GIVEN** the active season has no `format`
- **WHEN** `save_question` is called
- **THEN** the new entry has no `slot` field

#### Scenario: submit_answers stamps season on each answer

- **GIVEN** the active season in `games/main/seasons.json` is `"may-2026"`
- **WHEN** `submit_answers` is called with `game: "main"` and records three new answer entries
- **THEN** each entry in `games/main/answers.json` includes `season: "may-2026"`
- **AND** none of the entries include a `slot` field (slot is a question-level concept)

#### Scenario: save_cheating stamps season

- **GIVEN** the active season in `games/main/seasons.json` is `"may-2026"`
- **WHEN** `save_cheating` is called with `game: "main"` and records a cheat
- **THEN** the entry in `games/main/cheats.json` includes `season: "may-2026"`

#### Scenario: Writes during a gap have no season tag

- **GIVEN** `findCurrentSeason(games/main/seasons.json, now)` returns `null`
- **WHEN** any tag-stamping tool writes a new entry with `game: "main"`
- **THEN** the new entry contains no `season` field
- **AND** the new entry contains no `slot` field

#### Scenario: Disabled config skips tagging

- **GIVEN** `seasons.enabled` is `false`
- **WHEN** any tool writes to a game's `questions.json`, `answers.json`, or `cheats.json`
- **THEN** no `season` field is present on the new records
- **AND** no `slot` field is present on the new records

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
  }>,
  flexible?: boolean
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
8. `format.flexible`, when present, MUST be a boolean. When absent it reads as `false`. The same field is accepted identically on a game-tier `format`.

Resolution for a question-cron fire SHALL follow the cascade: `season.format → game.format → (single-question fallback)`. The first present tier wins as a whole (including its `flexible` value). When neither the season nor the game provides a `format`, the cron fire SHALL post a single question rolled from the season's `categories`, `answersFormat`, `questionType`, and `contexts`.

When the resolved `format` is NOT flexible (`flexible` absent or `false`), each question-cron fire SHALL post `format.questions.length` questions (one per slot, in array order). The same applies when the game's `format` is present and the season's is absent — the game's slot count drives the fire's posted count.

When the resolved `format` has `flexible: true`, each question-cron fire SHALL post a PREFIX of the slots — between `0` and `format.questions.length` questions inclusive, filled in array order — with the count chosen during generation by available material. Posting fewer than `questions.length` (including zero, which skips the day) is valid. Slot definitions and `save_question` index validation (`[0, questions.length)`) are unchanged.

#### Scenario: No season format and no game format behaves as pre-format

- **GIVEN** a season entry with no `format` field and a game entry with no `format` field
- **WHEN** the question cron fires
- **THEN** a single question is posted using the resolved `categories`, `answersFormat`, `questionType`, and `contexts`

#### Scenario: Season with format posts one question per slot

- **GIVEN** a season entry with `format: { questions: [{ label: "GK 1" }, { label: "History Choice", answersFormat: { boolean: 0, choice: 1 } }] }`
- **WHEN** the question cron fires
- **THEN** exactly two questions are posted in that order

#### Scenario: Season format wins over game format

- **GIVEN** game `main` has `format: { questions: [{}] }` (1 slot) and the active season has `format: { questions: [{}, {}, {}] }` (3 slots)
- **WHEN** the question cron fires for game `main`
- **THEN** exactly three questions are posted (season tier takes precedence)

#### Scenario: Game format used when season has none

- **GIVEN** the active season has no `format` field and game `main` has `format: { questions: [{}, {}] }` (2 slots)
- **WHEN** the question cron fires for game `main`
- **THEN** exactly two questions are posted

#### Scenario: Flexible format posts a prefix when material is thin

- **GIVEN** the active season has no `format` and game `main` has `format: { questions: [{}, {}, {}], flexible: true }`
- **AND** usable material exists for slots 0 and 1 but not slot 2
- **WHEN** the question cron fires for game `main`
- **THEN** exactly two questions are posted (slots 0 and 1)

#### Scenario: Flexible format posts zero and skips the day

- **GIVEN** game `main` has `format: { questions: [{}], flexible: true }` and no usable material this fire
- **WHEN** the question cron fires for game `main`
- **THEN** zero questions are posted and the run terminates cleanly with no error

#### Scenario: Flexible flag accepted on write

- **WHEN** `upsert_season` is called with `format: { questions: [{}, {}], flexible: true }`
- **THEN** the call succeeds and the stored season format carries `flexible: true`

#### Scenario: Non-boolean flexible rejected on write

- **WHEN** `upsert_season` is called with `format: { questions: [{}], flexible: "sometimes" }`
- **THEN** the call is rejected with an error identifying `format.flexible` as needing a boolean

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

When the active season has a `format` OR the game has a `format` (with season absent), the `save_question` MCP tool SHALL require a `slot: { index: number, label?: string }` argument. The tool SHALL:

1. Reject the call with a structured "slot required" error if `slot` is omitted.
2. Reject the call with a structured "slot index out of range" error if `slot.index` is not in `[0, format.questions.length)` where `format` is the effective format from the `season.format → game.format` cascade.
3. Resolve the slot's effective `answersFormat` via the cascade `slot.answersFormat ?? season.answersFormat ?? game.answersFormat ?? config.trivia.answersFormat` and reject the call with an "answers format not permitted by slot" error if the question's actual `answersFormat` value is not in the slot's permitted set (weight > 0).
4. Resolve the slot's effective `questionType` via the cascade `slot.questionType ?? season.questionType ?? game.questionType ?? config.trivia.questionType` and reject the call with a "question type not permitted by slot" error if the question's actual `questionType` value is not in the slot's permitted set (weight > 0).
5. Resolve the slot's effective `categories` via the cascade `slot.categories ?? season.categories ?? game.categories` and reject the call with a "category not in slot pool" error if the question's `category` is not in that resolved pool. When none of the three tiers supplies categories, the global `categories.json` is the active pool.
6. Resolve the slot's effective `contexts` via the cascade `slot.contexts ?? season.contexts ?? game.contexts ?? config.trivia.contexts` (may be absent) and reject the call with a "context not in slot lens list" error if a non-empty `context` argument is provided but does not appear in the resolved contexts list.
7. Snapshot `slot: { index, label }` onto the saved question record where `label` is taken from the resolved `format.questions[index].label` at the moment of write.

When neither the active season nor the game has a `format`, the `save_question` tool SHALL reject any `slot` argument with a structured "no active format" error.

#### Scenario: Save with valid slot succeeds and snapshots label

- **GIVEN** the active season has `format: { questions: [{ label: "GK 1" }, { label: "History Choice", categories: ["History"], answersFormat: { choice: 1 } }] }`
- **WHEN** `save_question` is called with `slot: { index: 1 }`, `answersFormat: "choice"`, `questionType: "fact"`, `category: "History"`, valid choices/correctIndex
- **THEN** the call succeeds and the saved record carries `slot: { index: 1, label: "History Choice" }`

#### Scenario: Save with valid slot using game format

- **GIVEN** the active season has no `format` and game `main` has `format: { questions: [{ label: "Daily" }] }`
- **WHEN** `save_question` is called with `game: "main", slot: { index: 0 }`, valid payload
- **THEN** the call succeeds and the saved record carries `slot: { index: 0, label: "Daily" }`

#### Scenario: Missing slot argument when format present

- **GIVEN** the active season has a `format` (or the game has a format with no season format)
- **WHEN** `save_question` is called with no `slot` argument
- **THEN** the call is rejected with a "slot required" error

#### Scenario: Slot index out of range

- **WHEN** `save_question` is called with `slot: { index: 99 }` and the effective format has 2 slots
- **THEN** the call is rejected with a "slot index out of range" error

#### Scenario: Answers format not permitted by slot

- **GIVEN** the effective format's slot 0 has `answersFormat: { choice: 1 }` (boolean weight 0)
- **WHEN** `save_question` is called with `slot: { index: 0 }, answersFormat: "boolean", ...`
- **THEN** the call is rejected with an "answers format not permitted by slot" error

#### Scenario: Question type not permitted by slot

- **GIVEN** the effective format's slot 0 has `questionType: { fact: 1 }` (topical weight 0)
- **WHEN** `save_question` is called with `slot: { index: 0 }, questionType: "topical", ...`
- **THEN** the call is rejected with a "question type not permitted by slot" error

#### Scenario: Category not in slot's resolved pool

- **GIVEN** the effective format's slot 0 has `categories: ["History"]`
- **WHEN** `save_question` is called with `slot: { index: 0 }, category: "Science"`
- **THEN** the call is rejected with a "category not in slot pool" error

#### Scenario: Context not in slot's lens list

- **GIVEN** the effective format's slot 0 has `contexts: [{ name: "Quebec" }]`
- **WHEN** `save_question` is called with `slot: { index: 0 }, context: "International"`
- **THEN** the call is rejected with a "context not in slot lens list" error

#### Scenario: Slot argument rejected when no format is active

- **GIVEN** the active season has no `format` AND the game has no `format`
- **WHEN** `save_question` is called with any `slot` argument
- **THEN** the call is rejected with a "no active format" error

### Requirement: Lazy per-game season bootstrap

Per-game seasons bootstrap SHALL happen lazily on first use of a game's `seasons.json` rather than at plugin-load time. The previous plugin-load-time bootstrap (which created `data/plugins/trivia/seasons.json` once) is removed.

The lazy bootstrap is a FALLBACK safety net, not the primary creation path. A game created through `upsert_game` while `trivia.seasons.enabled` is `true` SHALL have its first season written from the required `initialSeason` argument at creation time (see the `trivia-games` capability), so its `seasons.json` already exists and the lazy bootstrap never fires for it. The lazy bootstrap exists to cover games that acquire a `seasons.json` by some other route — games added by hand-editing `config.trivia.games[]`, or pre-existing games from before this requirement — so that no per-game tool ever observes a seasons-enabled game with a null current season.

When any tool resolves a `game` argument AND `trivia.seasons.enabled` is `true` AND the named game's `data/plugins/trivia/games/<game>/seasons.json` is missing, the plugin SHALL seed that file with exactly one entry whose:

- `slug` is computed deterministically as `season-YYYY-MM` based on the current UTC month.
- `startedAt` is `Date.now()`.
- `expectedEndAt` is end-of-current-UTC-month.

The seeded entry SHALL NOT carry a `categories`, `format`, `theme`, or any axis field — it inherits its category pool and every axis from the cascade (game tier, else the global `categories.json` / built-in defaults), consistent with the seasons.json file-schema requirement.

Pre-migration data moved into the per-game directory layout by migration 019 (whether the destination is `legacy-<channel>`, an existing config entry, or the fallback `initialgame`) is NOT backfilled with a `season` field — those entries remain untagged and contribute to all-time totals only.

#### Scenario: First per-game tool call seeds seasons.json for a config-edited game

- **GIVEN** `trivia.seasons.enabled` is `true` and `games/staging/seasons.json` does not exist
- **AND** the `"staging"` game was added by editing `config.trivia.games[]` directly (not via `upsert_game`)
- **WHEN** `get_ideas` is called with `game: "staging"`
- **THEN** `games/staging/seasons.json` is created with one starter entry before `get_ideas` returns

#### Scenario: Lazy bootstrap does not fire for an upsert_game-created game

- **GIVEN** `trivia.seasons.enabled` is `true`
- **AND** the `"ops"` game was created via `upsert_game` with an `initialSeason`, so `games/ops/seasons.json` already exists
- **WHEN** any per-game tool is called with `game: "ops"`
- **THEN** no seasons bootstrap fires
- **AND** the existing `initialSeason` entry is unchanged (the machine-derived `season-YYYY-MM` starter is NOT written)

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

### Requirement: trivia-check instruction advertises games and timeline management

The `trivia-check` instruction registered by the Trivia plugin SHALL include guidance directing Claude that:

1. Every per-game trivia tool requires a `game: string` argument.
2. In reactive sessions (DM / mention / reaction), Claude SHALL resolve the game from the channel via the channel-inference helper (or its conceptual equivalent — checking `config.trivia.games[]` for an entry whose `channel` matches the session's channel ID).
3. Claude MAY call `list_games` to discover available games.
4. The plugin's user-facing output SHALL NOT mention `game` slugs to end-users unless an admin explicitly asks; the slug is an internal coordination token between Claude and the tools.

When `seasons.enabled` is `true`, the instruction SHALL additionally include guidance for the season-management tools (`upsert_season(game, ...)`, `delete_season(game, slug)`, `list_seasons(game)`, `add_categories({ game, target: "<slug>" })`, `remove_categories({ game, target: "<slug>" })`), the rule that `categories` on `upsert_season` REPLACES the baseline (for themed seasons), and the semantic that each game's timeline is independent.

When `seasons.enabled` is `false`, the instruction SHALL NOT include the season-tool guidance.

#### Scenario: Instruction includes game-arg guidance

- **WHEN** a session loads the `trivia-check` instruction
- **THEN** the resolved instruction text references the `game` argument required by per-game tools
- **AND** the resolved text directs Claude to use channel inference (or `list_games`) to determine the game in reactive sessions
- **AND** the resolved text directs Claude not to surface the slug to end-users

#### Scenario: Instruction includes timeline guidance when seasons enabled

- **GIVEN** `seasons.enabled` is `true`
- **WHEN** a session loads the `trivia-check` instruction
- **THEN** the resolved instruction text references `upsert_season`, `delete_season`, and `list_seasons` by name with their `game` argument
- **AND** each game's timeline is described as independent
- **AND** the instruction does NOT reference `start_new_season` (obsolete name) or `end_season` (a reveal-flow / management-topic tool, not timeline guidance)

#### Scenario: Instruction omits timeline guidance when seasons disabled

- **GIVEN** `seasons.enabled` is `false`
- **WHEN** a session loads the `trivia-check` instruction
- **THEN** the resolved instruction text does NOT reference any timeline tools

### Requirement: difficultyRatio axis at season and slot tiers

A season's stored record (`SeasonEntry` in `seasons.json`) and a slot's stored record (`format.questions[i]`) SHALL each accept an optional `difficultyRatio?: TriviaDifficultyRatioConfig` field (per-format keyed map of `{ easy, medium, hard }` weights — same shape as `config.trivia.difficultyRatio` per the `trivia-games` capability).

The `upsert_season` MCP tool SHALL accept `difficultyRatio` as an optional argument with the same create / update / clear semantics as the other axis fields (`answersFormat`, `questionType`, `contexts`, `freeformAnswerShape`):

- On CREATE, when provided, stored verbatim after validation.
- On UPDATE, an object value replaces the entry's existing `difficultyRatio`; explicit `null` clears the field; omission preserves the existing value.
- Mid-season mutation is permitted.

Slots inside `format.questions` SHALL likewise accept `difficultyRatio` as an optional per-slot field on `upsert_season` calls. Slot-tier `difficultyRatio` SHALL win over season-tier when both are set.

The `list_seasons` tool's return shape SHALL include `difficultyRatio?: TriviaDifficultyRatioConfig` on each season entry AND on each slot inside `format.questions`. The field SHALL be present IF AND ONLY IF the corresponding stored record carries an explicit value.

Validation invariants (enforced by `upsert_season`):

- Each per-format inner weight map (the `{ easy, medium, hard }`) SHALL contain only non-negative integers and SHALL have at least one strictly positive entry.
- Unknown keys at either level (formats other than `boolean` / `choice` / `freeform`; buckets other than `easy` / `medium` / `hard`) SHALL be rejected with a structured error.

#### Scenario: Create a season with difficultyRatio

- **WHEN** `upsert_season` is called with `game: "main", slug: "june-2026", startedAt: <T>, expectedEndAt: <T+30d>, difficultyRatio: { boolean: { easy: 5, medium: 3, hard: 1 } }`
- **THEN** the response carries `hasDifficultyRatio: true`
- **AND** the new entry carries `difficultyRatio: { boolean: { easy: 5, medium: 3, hard: 1 } }` verbatim

#### Scenario: Update a season's difficultyRatio mid-season

- **GIVEN** the active "may-2026" season has `startedAt <= now` and `difficultyRatio: { boolean: { easy: 1, medium: 1, hard: 1 } }`
- **WHEN** `upsert_season(game: "main", slug: "may-2026", { difficultyRatio: { boolean: { easy: 0, medium: 1, hard: 0 } } })` is called
- **THEN** the response is `{ action: "updated", hasDifficultyRatio: true, ... }`
- **AND** the entry's `difficultyRatio` is now `{ boolean: { easy: 0, medium: 1, hard: 0 } }`

#### Scenario: Clear a season's difficultyRatio by passing null

- **GIVEN** the active "may-2026" season has `difficultyRatio` set
- **WHEN** `upsert_season(game: "main", slug: "may-2026", { difficultyRatio: null })` is called
- **THEN** the entry's `difficultyRatio` field is removed
- **AND** the response carries `hasDifficultyRatio: false`

#### Scenario: Slot-tier difficultyRatio inside format

- **WHEN** `upsert_season` is called with a `format` whose `questions[1].difficultyRatio.choice` is `{ easy: 0, medium: 0, hard: 1 }`
- **THEN** the stored slot carries that `difficultyRatio` verbatim
- **AND** `list_seasons` surfaces `format.questions[1].difficultyRatio` matching the stored value
- **AND** `format.questions[0]` has no `difficultyRatio` field

#### Scenario: All-zeros inner weight map rejected

- **WHEN** `upsert_season` is called with `difficultyRatio: { boolean: { easy: 0, medium: 0, hard: 0 } }`
- **THEN** the call returns a structured validation error indicating the inner map must have at least one strictly positive weight

#### Scenario: Unknown bucket key rejected

- **WHEN** `upsert_season` is called with `difficultyRatio: { boolean: { easy: 1, medium: 1, hard: 1, expert: 1 } }`
- **THEN** the call returns a structured validation error naming `expert` as an unknown bucket

#### Scenario: list_seasons omits difficultyRatio when unset

- **GIVEN** a season entry has no `difficultyRatio` field
- **WHEN** `list_seasons` is invoked
- **THEN** that entry has no `difficultyRatio` field in the response

### Requirement: Per-season and per-slot `revealResponses` accept `"just-winners"`

The optional `revealResponses` field on `SeasonEntry` and on each slot entry within `SeasonFormat.questions[]` SHALL accept `"just-winners"` in addition to `"no"`, `"just-correctness"`, and `"yes"`. These values participate in the existing `slot → season → game → workspace → "yes"` cascade resolved at `post_questions` time. The `upsert_season` tool SHALL validate and persist the value, and `list_seasons` SHALL surface per-season and per-slot `"just-winners"` when set.

#### Scenario: Season-level just-winners resolves through the cascade

- **GIVEN** a season entry with `revealResponses: "just-winners"`, no slot override, game default absent, workspace default `"yes"`
- **WHEN** `post_questions` stamps a question for that season
- **THEN** the stamped value is `"just-winners"`

#### Scenario: list_seasons surfaces a just-winners slot override

- **GIVEN** a `SeasonFormat.questions[i]` slot with `revealResponses: "just-winners"`
- **WHEN** an admin calls `list_seasons`
- **THEN** the output reports `revealResponses: "just-winners"` for that slot

### Requirement: Seasons leaderboard row composition (normal reveals)

When the `process_reveal_answers` payload includes a `seasonStatus` field (seasons enabled AND a current season exists) AND `seasonStatus.isLastFireOfSeason` is `false`, the reveal leaderboard `table` SHALL be composed additively from these rows, top to bottom:

- A names-header row: empty top-left label cell (a single space `" "`, never `""`), then one `displayName` cell per player column (no medals).
- A `This Round` row — present whenever `roundSummary` is present (see `trivia-scheduled-prompts` → "Reveal table leads with This Round").
- A `Current Season` row — ALWAYS present (the anchor row), each cell `String(currentSeasonCorrect)`.
- An `All Time` row — present IF AND ONLY IF `seasonStatus.hasPriorSeasons` is `true` AND `showAllTimeRow` is `true` (see "process_reveal_answers resolves allTimeRow"), each cell `String(totalCorrect)`.

When `seasonStatus.hasPriorSeasons` is `false` (only one season has had activity), the `All Time` row SHALL be omitted and the `Current Season` row SHALL still render with its `"Current Season"` label — replacing the prior unlabeled two-row form for the single-season case.

Player columns SHALL include only leaderboard entries with current-season participation (`currentSeasonCorrect > 0` OR `currentSeasonAnswered > 0`); the column order SHALL be the single shared order defined by `trivia-scheduled-prompts` (by `This Round` when present, else by `currentSeasonCorrect` descending). Any player appearing in `roundSummary.perPlayer` necessarily satisfies this inclusion rule — their this-round answer is stamped with the current season, so `currentSeasonAnswered > 0` — therefore the `This Round` source set is always a subset of the column set and never introduces a column the season rows lack. Medals on the `Current Season` and `All Time` rows SHALL follow the unified dense-rank rule, assigned per row independently. `column_settings` SHALL carry one `{ "align": "center" }` entry per column (label column + each player column).

#### Scenario: Multi-season normal reveal with All Time shown

- **GIVEN** `seasonStatus.hasPriorSeasons` is `true`, `isLastFireOfSeason` is `false`, `showAllTimeRow` is `true`, and `roundSummary` is present
- **WHEN** the reveal renders the leaderboard
- **THEN** the rows are names-header → This Round → Current Season → All Time
- **AND** every row uses the same column order (by This Round score, em-dash players last)

#### Scenario: All Time hidden by allTimeRow default

- **GIVEN** `seasonStatus.hasPriorSeasons` is `true`, `isLastFireOfSeason` is `false`, and `showAllTimeRow` is `false`
- **WHEN** the reveal renders the leaderboard
- **THEN** the table has no `All Time` row
- **AND** the rows are names-header → (This Round when present) → Current Season

#### Scenario: Single-season reveal labels the anchor row "Current Season"

- **GIVEN** `seasonStatus.hasPriorSeasons` is `false` and `isLastFireOfSeason` is `false`
- **WHEN** the reveal renders the leaderboard
- **THEN** the table contains a `Current Season` labeled row and no `All Time` row
- **AND** the prior unlabeled two-row single-season form is not used

#### Scenario: Zero-participation player omitted

- **GIVEN** a player with `currentSeasonCorrect: 0` and `currentSeasonAnswered: 0`
- **WHEN** the reveal renders the leaderboard
- **THEN** that player does not appear as a column

### Requirement: process_reveal_answers resolves allTimeRow into showAllTimeRow

When seasons are enabled and a current season exists, `process_reveal_answers` SHALL resolve the `allTimeRow` axis (cascade `game → workspace → "end-of-season-only"`, see `trivia-games`) and compute a boolean `showAllTimeRow` that it includes in the returned payload:

- `allTimeRow === "always"` → `showAllTimeRow = true`.
- `allTimeRow === "never"` → `showAllTimeRow = false`.
- `allTimeRow === "end-of-season-only"` → `showAllTimeRow = seasonStatus.isLastFireOfSeason`.

When `showAllTimeRow` is absent from the payload (e.g. older payloads, or seasons disabled), the renderer SHALL treat it as `true` for backward compatibility. `showAllTimeRow` governs BOTH the normal-reveal `All Time` row and the finale All-Time table; the All-Time surface additionally requires `seasonStatus.hasPriorSeasons === true`. Both `hasPriorSeasons` and `isLastFireOfSeason` SHALL reflect the timeline state as of reveal start — i.e. BEFORE the in-tool season-end rollover — so the All-Time gate is decided against the season that is closing, not any continuation season created during the same call.

#### Scenario: end-of-season-only resolves on last fire

- **GIVEN** the resolved `allTimeRow` is `"end-of-season-only"` and `seasonStatus.isLastFireOfSeason` is `true`
- **WHEN** `process_reveal_answers` builds its payload
- **THEN** `showAllTimeRow` is `true`

#### Scenario: end-of-season-only hides on normal day

- **GIVEN** the resolved `allTimeRow` is `"end-of-season-only"` and `seasonStatus.isLastFireOfSeason` is `false`
- **WHEN** `process_reveal_answers` builds its payload
- **THEN** `showAllTimeRow` is `false`

#### Scenario: never always hides

- **GIVEN** the resolved `allTimeRow` is `"never"`
- **WHEN** `process_reveal_answers` builds its payload
- **THEN** `showAllTimeRow` is `false` regardless of `isLastFireOfSeason`

### Requirement: Season-finale reveal layout

When `seasons.enabled` is `true` AND `seasonStatus.isLastFireOfSeason` is `true`, the reveal flow SHALL render a dedicated finale layout in place of the normal leaderboard table, in this order:

1. The per-question verdict blocks for the round just revealed (as in any reveal).
2. A **Season Winners** section introduced by a transition line (e.g. "And now, the season's winners!"). It SHALL present the final current-season standings as a vertical ranked list: the top three DISTINCT `currentSeasonCorrect` values rendered as `🥇 First place`, `🥈 Second place`, `🥉 Third place` lines (players tied on a value SHALL share that place and medal), each line naming the player(s) and their points (`currentSeasonCorrect`). The place labels (`First place` / `Second place` / `Third place`) SHALL be sourced from the trivia i18n dictionary and rendered in the configured language — they SHALL NOT be fixed English literals; the medal glyphs and `String(...)` point values are language-neutral.
3. A one-line **participation tail** listing every remaining participant (below the podium) with their points, comma-separated; the player(s) at the 4th distinct value SHALL carry the `🎀` ribbon. Players with zero current-season participation SHALL be omitted. The tail's label (e.g. `Participation:`) SHALL be sourced from the trivia i18n dictionary and rendered in the configured language.
4. An **All-Time table** — rendered IF AND ONLY IF `seasonStatus.hasPriorSeasons` is `true` AND `showAllTimeRow` is `true` — introduced by a transition line (e.g. "And the all-time leaderboard:"). It SHALL be a Slack `table` with a names-header row and an `All Time` row of `String(totalCorrect)`, columns ordered by `totalCorrect` descending, with medals following the unified dense-rank rule. The `All Time` row label SHALL be the configured-language dictionary value (per "Reveal leaderboard labels are localized via the trivia dictionary"). When the gate fails (single season, or `allTimeRow` hides it), the All-Time table SHALL be omitted.
5. A closer line. When the `end_season` result did NOT carry `gameDisabled: true`, the closer is the season-handoff style (e.g. "Thanks for playing, see you next season!") and SHALL NOT preview the next season's slug, even when the result carried `newSeasonStarted`. When the `end_season` result carried `gameDisabled: true` (the game wound down via `disableAfterRound`), the closer SHALL be a series wrap — the chapter closes for good, with NO "see you next season" and NO next-season preview.

"pts" SHALL mean `currentSeasonCorrect` — no separate scoring concept is introduced. Season-end close (stamping `endedAt` on the closing season and resolving the successor policy — promote a queued season, create a continuation, or wind the game down) SHALL be performed by the renderer flow calling `end_season` after `compute_answers` (which reports `seasonStatus` but performs no rollover, per `trivia-reveal-processor`); the renderer SHALL NOT call `upsert_season` as a follow-up. The close outcome SHALL be reported in the `end_season` result (`seasonClosed`, optional `newSeasonStarted`, optional `gameDisabled`) for informational use.

The transition and closer lines (steps 2, 4, 5) are free prose authored by Claude and SHALL continue to be translated via the LANGUAGE directive; only the fixed structural labels (place labels, participation label, `All Time` row label) are pre-localized from the dictionary. When the configured language is English the dictionary values equal the prior literals, so finale output is byte-identical to the pre-change behavior.

When `seasonStatus.isLastFireOfSeason` is `false` (or `seasonStatus` is absent), no finale layout is rendered and the normal leaderboard table (per "Seasons leaderboard row composition") is used.

#### Scenario: Finale renders podium, participation tail, and all-time table

- **GIVEN** `seasonStatus.isLastFireOfSeason` is `true`, `hasPriorSeasons` is `true`, and `showAllTimeRow` is `true`
- **WHEN** the reveal flow completes
- **THEN** the post contains a Season Winners podium with `🥇`/`🥈`/`🥉` place lines naming players and their `currentSeasonCorrect` points
- **AND** a one-line participation tail with the 4th distinct value carrying `🎀`
- **AND** an All-Time `table` with medals on the `All Time` row
- **AND** a "see you next season" style closer that does not preview the next season's slug
- **AND** `end_season` stamped `endedAt` before `submit_response` (no `upsert_season` follow-up)

#### Scenario: Wounded-down finale renders a series-wrap closer

- **GIVEN** `seasonStatus.isLastFireOfSeason` is `true` and the `end_season` result carried `gameDisabled: true`
- **WHEN** the reveal flow completes
- **THEN** the finale closer is a series wrap with no "see you next season" phrasing and no next-season preview

#### Scenario: Finale labels localized in a French workspace

- **GIVEN** the configured language is French and `seasonStatus.isLastFireOfSeason` is `true`
- **WHEN** the finale layout is built
- **THEN** the podium place labels render in French (e.g. `Première place`, `Deuxième place`, `Troisième place`) sourced from the dictionary

### Requirement: Apply-to-current-season clears the override

When an admin confirms that a shadowed game edit should take effect in the current season, the resolution SHALL CLEAR the season's override(s) for the confirmed field(s) (`upsert_season(slug, { <field>: null, ... })`) so they fall through to the new game value, rather than copying the game value into the season. This keeps the season holding only genuine season-specific deltas and prevents the season from silently drifting from the game on subsequent game edits. When multiple fields are shadowed, all the admin-confirmed fields MAY be cleared in a single `upsert_season` call. The clear SHALL only happen on explicit admin confirmation and SHALL target the season that is current at apply time; if the season has since ended, been deleted, or changed, the standard `upsert_season` validation applies (the clear errors or no-ops rather than mutating the wrong season).

#### Scenario: Confirmed apply clears the season override

- **WHEN** `upsert_game` reports `answersFormat` shadowed by the active season and the admin confirms "yes, apply to this season too"
- **THEN** Claude calls `upsert_season(slug, { answersFormat: null })`, and the next resolution for that season returns the game's value at tier `game`

#### Scenario: Multiple shadowed fields clear together

- **WHEN** `upsert_game` reports both `answersFormat` and `format` shadowed and the admin confirms applying both
- **THEN** Claude clears both in one call — `upsert_season(slug, { answersFormat: null, format: null })`

#### Scenario: Declining leaves the season override intact

- **WHEN** the admin declines to apply the change to the current season
- **THEN** the season override is left unchanged and the game edit takes effect only once the season ends (the next season inherits the new game value)

### Requirement: Sparse-season write philosophy generalized

The "omit to inherit from the game / global cascade" principle SHALL apply to EVERY cascading axis and `format`, not only `categories`. A season SHALL hold a field only when that field is an intentional season-specific override; absent fields inherit from the game tier. The admin instruction SHALL reflect that Clack almost never writes a season override unprompted — game configuration is authoritative and the season carries deltas.

#### Scenario: Non-scoped axis change does not write the season

- **WHEN** an admin changes a game's difficulty with no season qualifier while a season is active but does not override difficulty
- **THEN** only the game tier is written; the season remains free of a difficulty override and continues to inherit

#### Scenario: Season created without redundant fields

- **WHEN** a new season is created for a non-themed period
- **THEN** it is written without axis/format fields that merely duplicate the game, so it inherits them via the cascade

### Requirement: Season per-slot overrides via sparse slotOverrides map

A season MAY carry an optional `slotOverrides` map — `{ [slotIndex: number]: PartialSlotAxes }` — expressing per-slot field overrides layered over the game format's slots. When present, it SHALL be resolved as the `seasonSlot` tier of the cascade. Each value is a partial bag of the same per-question cascade axes a `SeasonFormatSlot` can carry (`answersFormat`, `questionType`, `promptMedium`, `freeformAnswerShape`, `contexts`, `difficulty`, `difficultyRatio`, `hint`, `judgeLeniency`, `instructions`, `additionalInstructions`, `liveAnswersVisible`, `revealResponses`, plus `categories`/`label`). The map is the `seasonSlot` tier in the cascade (`seasonSlot → season → gameSlot → game → workspace → default`): for slot index `i`, `slotOverrides[i]` overrides `game.format.questions[i]` field-by-field; fields the override leaves unset inherit the game slot.

`slotOverrides` SHALL be **count-decoupled**: it changes only the addressed slots' fields and never the number of questions a fire posts. The question count remains `game.format.questions.length` (or 1 when the game has no format). A season changes the count only by declaring its own structural `format`.

A season SHALL NOT set both `slotOverrides` and a structural `format`; the parser SHALL reject a season that sets both (v1 mutual exclusivity). The values in `slotOverrides` SHALL be validated by the same per-axis validators used for a `SeasonFormatSlot`.

#### Scenario: Override a single slot field without restating the list

- **WHEN** a game defines a 3-slot `format` and the active season sets `slotOverrides: { "2": { promptMedium: { image: 1 } } }`
- **THEN** slot 2 resolves `promptMedium` to `{ image: 1 }` (from `seasonSlot`)
- **AND** slots 0 and 1 inherit their full config from the game format
- **AND** the fire still posts 3 questions (the count is unchanged)

#### Scenario: Slot override inherits unset fields from the game slot

- **WHEN** the game slot 2 sets `answersFormat`, `difficulty`, and `category` and the season's `slotOverrides[2]` sets only `promptMedium`
- **THEN** slot 2 resolves `promptMedium` from the season override and `answersFormat`/`difficulty`/`category` from the game slot

#### Scenario: slotOverrides for an index the game format lacks

- **WHEN** the season sets `slotOverrides[5]` but the game format has only 3 slots
- **THEN** the override has no game slot to layer over (`gameSlot[5]` is `null`), and any axis it does not set falls through `seasonSlot → season → gameSlot (null) → game → workspace → default`
- **AND** the count is unaffected (still the game's)

#### Scenario: Both slotOverrides and a structural format is rejected

- **WHEN** `upsert_season` is called with both `slotOverrides` and `format` set
- **THEN** the tool returns a structured error stating the two are mutually exclusive on a season

#### Scenario: slotOverrides is surfaced for audit

- **WHEN** `list_seasons` reports a season carrying `slotOverrides`
- **THEN** the response includes the per-slot override map so an admin can audit it without rolling

### Requirement: Season config validation is schema-driven

Validation of season config (`SeasonEntry` axis fields, `SeasonFormatSlot` slots, `format`, `slotOverrides`, and per-season `categories`/`theme`/`instructions`) SHALL reuse the same rich zod schemas that validate the game tier — shape and semantics in one definition per concept, with no parallel hand-rolled validator layer. The `upsert_season` tool path SHALL validate against these schemas via `safeParse` rather than calling separate `validate*` functions after zod.

#### Scenario: Season and game share the slot schema

- **WHEN** an invalid `SeasonFormatSlot` field is supplied to `upsert_season` (e.g. a `categories` array that dedupes to empty)
- **THEN** it is rejected by the identical slot schema used for game-tier slots, producing the same error wording, with no season-specific validator duplicating the rule

### Requirement: zod-to-Result formatter is a shared SDK-layer leaf

A dependency-free SDK-layer leaf module (`src/plugins/zodResult.ts`, importing only `zod`) SHALL export `zodErrorToResult(error, fieldLabel)` returning the canonical `Result<T>` shape, and it SHALL be the single formatter used to turn a `ZodError` into a labeled `{ ok: false; error }`. It SHALL be importable by both plugins and bot core, so downstream config-validation changes reuse it rather than redefining it. The duplicate trivia `Result<T>` / `ValidateResult<T>` declarations SHALL be removed in favor of importing it.

#### Scenario: One Result type across trivia config

- **WHEN** trivia config code returns a validation result
- **THEN** it uses the single `Result<T>` imported from `src/plugins/zodResult.ts`, and no trivia module redeclares its own `Result`/`ValidateResult` alias

### Requirement: Season close stamps the effective teams roster and scoring mode

When a season ends (via `end_season` or the season-end path), and teams mode was effectively ON for the game, the system SHALL stamp the effective roster and effective `teamsScoring` onto the ending `SeasonEntry` in `seasons.json` as a single `teamsStamp: { teams, teamsScoring }` object — DISTINCT from the season-TIER config fields (`SeasonEntry.teams` etc. are one cascade tier's input; the stamp is the resolved output frozen for history, so a season-tier roster on an ended season where teams mode was OFF is never mistaken for team history). Ended seasons SHALL be scored from their stamp, immune to later config edits; the live season SHALL always be scored from live effective config. `teamsStamp` is OPTIONAL on `SeasonEntry` (graceful reader — legacy rows simply carry no team history). The stamp SHALL be written on the wind-down branch too (`disableAfterRound` games close their season like any other).

#### Scenario: Stamp written at close when teams were on

- **WHEN** a season with effective `teamsEnabled: true` is closed
- **THEN** the ending `SeasonEntry` persists the effective roster and scoring mode as of close time

#### Scenario: Stamp written when the season closes via wind-down

- **GIVEN** a game with `disableAfterRound: true` and effective `teamsEnabled: true`
- **WHEN** `end_season` closes the season through the wind-down branch (no successor created, game disabled)
- **THEN** the ending `SeasonEntry` persists the effective roster and scoring mode as of close time, same as a normal close

#### Scenario: No stamp when teams were off

- **WHEN** a season with teams mode off is closed
- **THEN** no teams fields are stamped on the ending entry

#### Scenario: Later config edits do not rewrite history

- **WHEN** an admin changes the game roster or `teamsScoring` after a season closed
- **THEN** the ended season's team scores (as used by all-time) are computed from its stamp, unchanged

#### Scenario: Legacy season entries load unchanged

- **WHEN** `seasons.json` contains entries without stamped teams fields
- **THEN** they load without error and contribute no team history

