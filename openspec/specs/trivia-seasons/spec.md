# Trivia Seasons

## Purpose

Optional competitive "chapters" for the Trivia plugin, modeled as a **timeline of seasons** scoped per-game. When enabled via `config.trivia.seasons`, the plugin maintains a `seasons.json` inside each game's directory (`data/plugins/trivia/games/<name>/seasons.json`) as a flat array of non-overlapping season intervals; "current" is a derived query against `now`. Every newly-written question/answer/cheat record is tagged with the active season's slug for its game (or omitted in a gap). The reveal flow renders a 3-row Current/All-Time leaderboard and, on the season's last fire, a wrap-up finale before rolling the timeline forward via `upsert_season`. Multiple future seasons can coexist as prepared drafts per game; admins refine their dates, names, and category pools before they go live. When disabled, the plugin writes no season tags.

## Requirements

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
    "categories": string[],                  // the season's category pool (non-empty)
    "questionTypes": Record<"boolean" | "choice", number>?
                                             // OPTIONAL per-season question-type weights; when absent, get_ideas falls back to config.trivia.questionsTypes
    "format": {
      "questions": Array<{
        "label"?: string,
        "categories"?: string[],
        "questionTypes"?: Record<"boolean" | "choice", number>
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
5. When present, each entry's `questionTypes` map SHALL contain only the keys `"boolean"` and `"choice"`, each mapped to a non-negative integer (zero is allowed and means "never roll this type"), AND at least one key SHALL be mapped to a strictly positive value.
6. When present, each entry's `format` SHALL satisfy the invariants in the "Per-season question format" requirement (non-empty `questions`, valid slot fields).

Per-game `seasons.json` files SHALL be created lazily — when any tool resolves `game = "X"` and finds no `games/X/seasons.json` while `trivia.seasons.enabled` is `true`, the plugin SHALL seed a starter season into that file before continuing. The starter entry's `slug` is `season-YYYY-MM` (current UTC month), `startedAt` is `Date.now()`, `expectedEndAt` is end-of-current-UTC-month, and `categories` is a copy of the global `categories.json`. The starter entry SHALL NOT carry a `format` field.

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
- **AND** the entry has no `questionTypes` field
- **AND** the entry has no `format` field

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

#### Scenario: Invalid questionTypes map is rejected

- **WHEN** an entry would be written with `questionTypes: { "boolean": 0, "choice": 0 }` (all-zero weights)
- **THEN** the write is rejected with a "questionTypes must have at least one positive weight" error
- **AND** the file is unchanged

#### Scenario: questionTypes with unknown keys is rejected

- **WHEN** an entry would be written with `questionTypes: { "boolean": 1, "trivia": 1 }` (unknown key)
- **THEN** the write is rejected with a "questionTypes keys must be 'boolean' or 'choice'" error
- **AND** the file is unchanged

#### Scenario: Invalid format on write rejected

- **WHEN** an entry would be written with `format: { questions: [] }`
- **THEN** the write is rejected with a "format.questions must be non-empty" error
- **AND** the file is unchanged

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

- `slug` (string, required) — non-empty kebab-case identifier. Treated as immutable: if the slug already exists _within the named game's timeline_, the call is an update of that entry; otherwise the call creates a new entry. Slug renaming is not supported (use `delete_season` + a new `upsert_season` for a not-yet-started entry). Slugs may collide with slugs in other games' timelines without issue.
- `startedAt` (number, optional, unix-ms) — required on CREATE; on UPDATE, modifying it is rejected if the existing entry's `startedAt <= now` (the past is immutable).
- `expectedEndAt` (number, optional, unix-ms) — required on CREATE; on UPDATE, the new value MUST still satisfy `startedAt < (endedAt ?? newExpectedEndAt)`.
- `endedAt` (number, optional, unix-ms) — sets the actual end time. Used to mark a season as closed (e.g. at the last-fire reveal or for early termination by an admin).
- `categories` (string[], optional) — the season's category pool. When provided AND non-empty, the new season's pool is **exactly** that list (replace, not augment — for purely themed seasons). When omitted OR empty, the new season's pool is copied from the global `categories.json` (the persistent baseline). Used only on CREATE; ignored on UPDATE (use `add_categories` / `remove_categories` with `target: <slug>` to refine an existing season's pool).
- `questionTypes` (`Record<"boolean" | "choice", number>` | null, optional) — per-season question-type weights. On CREATE, stored verbatim on the new entry. On UPDATE, an object value replaces the entry's existing `questionTypes`; explicit `null` clears the field, causing `get_ideas` to fall back to `config.trivia.questionsTypes` for that entry. Mutating `questionTypes` on a season whose `startedAt <= now` IS PERMITTED (unlike `startedAt`).
- `format` (`{ questions: Array<{ label?, categories?, questionTypes? }> }` | null, optional) — per-season question composition. On CREATE, stored verbatim on the new entry. On UPDATE, an object value replaces the entry's existing `format` wholesale; explicit `null` clears the field, causing the season to revert to single-question-per-fire behavior. Mutating `format` on a season whose `startedAt <= now` IS PERMITTED (the change takes effect on the next question-cron fire).

The tool SHALL:

1. Validate that `slug` is non-empty kebab-case.
2. Load the named game's `seasons.json` (initialize from scratch if missing — same shape as lazy seeding).
3. If creating: require both `startedAt` and `expectedEndAt`. Categories source — if `categories` arg is provided AND non-empty, use exactly that list (deduped, preserving first-occurrence order); otherwise copy the global `categories.json`. Reject if the resulting list is empty. Verify the new entry's `[startedAt, endedAt ?? expectedEndAt)` interval does not overlap any existing entry's interval _within the same game_. If `questionTypes` is provided, validate per the schema invariants. If `format` is provided, validate per the format invariants.
4. If updating: load the existing entry in the named game, apply the passed fields (omit-to-keep semantics; explicit `null` for `questionTypes` or `format` clears the respective field), re-validate the same invariants, and reject any attempt to mutate `startedAt` of an already-started season.
5. Atomically write the new `games/<game>/seasons.json`.

Return shape: `{ game, slug, action: "created" | "updated", startedAt, expectedEndAt, endedAt, categoriesCount, hasQuestionTypes, hasFormat, slotCount }`. `slotCount` is `format.questions.length` when `hasFormat`, else `0`.

#### Scenario: Create a future season with format

- **GIVEN** `games/main/seasons.json` contains only the active "may-2026" season
- **WHEN** `upsert_season` is called with `game: "main", slug: "june-2026", startedAt: <June 1>, expectedEndAt: <June 30>, format: { questions: [{ label: "GK Boolean" }, { label: "History Choice", questionTypes: { boolean: 0, choice: 1 }, categories: ["History"] }] }`
- **THEN** the response is `{ game: "main", slug: "june-2026", action: "created", hasFormat: true, slotCount: 2, ... }`
- **AND** the new entry carries the provided `format` verbatim

#### Scenario: Update a season's format mid-season

- **GIVEN** the active "may-2026" season in `games/main/seasons.json` has `startedAt <= now` and a 1-slot format
- **WHEN** `upsert_season(game: "main", slug: "may-2026", { format: { questions: [{ label: "A" }, { label: "B" }] } })` is called
- **THEN** the response is `{ game: "main", slug: "may-2026", action: "updated", hasFormat: true, slotCount: 2, ... }`
- **AND** the entry's `format` is the new 2-slot definition
- **AND** the next question-cron fire posts 2 questions

#### Scenario: Clear a season's format by passing null

- **GIVEN** the active "may-2026" in `games/main/seasons.json` has a `format` with 3 slots
- **WHEN** `upsert_season(game: "main", slug: "may-2026", { format: null })` is called
- **THEN** the entry's `format` field is removed
- **AND** the response carries `hasFormat: false, slotCount: 0`
- **AND** the next question-cron fire posts a single question

#### Scenario: Create a future season with questionTypes within a game

- **GIVEN** `games/main/seasons.json` contains only the active "may-2026" season
- **WHEN** `upsert_season` is called with `game: "main", slug: "june-2026", startedAt: <June 1>, expectedEndAt: <June 30>, questionTypes: { "boolean": 2, "choice": 1 }`
- **THEN** the response is `{ game: "main", slug: "june-2026", action: "created", hasQuestionTypes: true, ... }`
- **AND** the new entry carries `questionTypes: { "boolean": 2, "choice": 1 }`

#### Scenario: Create a themed future season (categories replace baseline)

- **GIVEN** `games/main/seasons.json` contains only the active "may-2026" season
- **WHEN** `upsert_season` is called with `game: "main", slug: "june-2026", startedAt: <June 1>, expectedEndAt: <June 30 23:59>, categories: ["Cephalopods", "Coral Reefs", "Tides", ...20 themed entries]`
- **THEN** the response is `{ game: "main", slug: "june-2026", action: "created", ... }`
- **AND** "june-2026"'s `categories` equals exactly the provided list (no baseline mixing)

#### Scenario: Create a non-themed season (omit categories → copy baseline)

- **GIVEN** the global `categories.json` contains 50 baseline entries
- **WHEN** `upsert_season` is called with `game: "main", slug: "july-2026", startedAt: <Jul 1>, expectedEndAt: <Jul 31 23:59>` (no `categories` arg)
- **THEN** the new entry's `categories` in `games/main/seasons.json` is a copy of the global `categories.json` (50 entries)

#### Scenario: Provided categories are deduped

- **GIVEN** the global `categories.json` contains `["Science", "History", "Geography"]`
- **WHEN** `upsert_season(game: "main", slug: "marine-2026-06", startedAt: <June 1>, expectedEndAt: <June 30>, categories: ["Cephalopods", "Cephalopods", "Tides"])` is called
- **THEN** the resulting entry's `categories` is `["Cephalopods", "Tides"]` — duplicates collapsed, baseline NOT mixed in

#### Scenario: Update a season's questionTypes mid-season

- **GIVEN** the active "may-2026" season in `games/main/seasons.json` has `startedAt <= now` and `questionTypes: { "boolean": 1 }`
- **WHEN** `upsert_season(game: "main", slug: "may-2026", { questionTypes: { "choice": 1 } })` is called
- **THEN** the response is `{ game: "main", slug: "may-2026", action: "updated", hasQuestionTypes: true, ... }`
- **AND** the entry's `questionTypes` is now `{ "choice": 1 }`
- **AND** the next `get_ideas` call rolls only `"choice"` types

#### Scenario: Clear a season's questionTypes by passing null

- **GIVEN** the active "may-2026" in `games/main/seasons.json` has `questionTypes: { "choice": 1 }`
- **WHEN** `upsert_season(game: "main", slug: "may-2026", { questionTypes: null })` is called
- **THEN** the entry's `questionTypes` field is removed
- **AND** the response carries `hasQuestionTypes: false`
- **AND** subsequent `get_ideas` calls fall back to `config.trivia.questionsTypes`

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

#### Scenario: questionTypes with all-zero weights rejected

- **WHEN** `upsert_season` is called with `questionTypes: { "boolean": 0, "choice": 0 }`
- **THEN** the call is rejected with a "questionTypes must have at least one positive weight" error

#### Scenario: questionTypes with unknown keys rejected

- **WHEN** `upsert_season` is called with `questionTypes: { "boolean": 1, "essay": 1 }`
- **THEN** the call is rejected with a "questionTypes keys must be 'boolean' or 'choice'" error

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

When `seasons.enabled` is `true`, the Trivia plugin SHALL expose a `list_seasons` MCP tool gated to the `admin` role that returns every entry on a specified game's timeline with full details.

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
    status: "past" | "current" | "future"
  }>,
  total: number
}
```

The `status` field is derived per entry against `Date.now()`:

- `"future"` when `startedAt > now`
- `"past"` when `(endedAt ?? expectedEndAt) <= now`
- `"current"` otherwise

Entries SHALL be returned in their stored order. The full `categories` array is included for every entry.

#### Scenario: Returns every timeline entry for the named game with status flags

- **GIVEN** `games/main/seasons.json` contains a past season, the active season, and a queued future season
- **WHEN** `list_seasons` is invoked with `game: "main"`
- **THEN** the response includes all three entries from the `main` timeline
- **AND** the past entry's `status` is `"past"`
- **AND** the active entry's `status` is `"current"`
- **AND** the future entry's `status` is `"future"`
- **AND** each entry includes its full `categories` array
- **AND** no entries from `games/sandbox/seasons.json` appear in the response

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

When `seasons.enabled` is `true`, the Trivia plugin SHALL accept an optional `format` field on each season entry in `data/plugins/trivia/games/<game>/seasons.json`. When present, the field MUST conform to:

```
format: {
  questions: Array<{
    label?: string,
    categories?: string[],
    questionTypes?: Record<"boolean" | "choice", number>
  }>
}
```

Invariants:

1. `format.questions` MUST be a non-empty array (rejected with a "format.questions must be non-empty" error on write).
2. Each slot's `label`, when present, MUST be a non-empty string after trim.
3. Each slot's `categories`, when present, MUST be a non-empty array of strings (deduped, preserving first-occurrence order).
4. Each slot's `questionTypes`, when present, MUST contain only the keys `"boolean"` and `"choice"`, each mapped to a non-negative integer, AND at least one key MUST be mapped to a strictly positive value.
5. All slot fields are optional individually; an entirely empty slot (`{}`) is permitted and means "use season defaults for everything".

When a season's `format` is absent, the season SHALL behave as before this change: each question-cron fire posts a single question rolled from the season's `categories` and `questionTypes`.

When a season's `format` is present, each question-cron fire SHALL post `format.questions.length` questions (one per slot, in array order).

#### Scenario: Season without format behaves as before

- **GIVEN** a season entry with no `format` field
- **WHEN** the question cron fires
- **THEN** a single question is posted using the season's `categories` and `questionTypes` as today

#### Scenario: Season with format posts one question per slot

- **GIVEN** a season entry with `format: { questions: [{ label: "GK 1" }, { label: "History Choice", questionTypes: { boolean: 0, choice: 1 } }] }`
- **WHEN** the question cron fires
- **THEN** exactly two questions are posted in that order

#### Scenario: Empty questions array rejected on write

- **WHEN** `upsert_season` is called with `format: { questions: [] }`
- **THEN** the call is rejected with a "format.questions must be non-empty" error
- **AND** `seasons.json` is unchanged

#### Scenario: Invalid slot.questionTypes rejected

- **WHEN** `upsert_season` is called with `format: { questions: [{ questionTypes: { boolean: 0, choice: 0 } }] }`
- **THEN** the call is rejected with a "questionTypes must have at least one positive weight" error

#### Scenario: Empty slot is permitted

- **WHEN** `upsert_season` is called with `format: { questions: [{}] }`
- **THEN** the call succeeds; the slot inherits all defaults from the season at posting time

### Requirement: save_question slot binding

When the active season (per `findCurrentSeason(games/<game>/seasons.json, now)`) has a `format`, the `save_question` MCP tool SHALL require a `slot: { index: number, label?: string }` argument. The tool SHALL:

1. Reject the call with a structured "slot required" error if `slot` is omitted.
2. Reject the call with a structured "slot index out of range" error if `slot.index` is not in `[0, format.questions.length)`.
3. Resolve the slot's effective `questionTypes` via the cascade `slot.questionTypes ?? season.questionTypes ?? config.trivia.questionsTypes` and reject the call with a "question type not permitted by slot" error if the question's actual type (boolean vs choice) is not in the slot's permitted set (weight > 0).
4. Resolve the slot's effective `categories` via the cascade `slot.categories ?? season.categories` and reject the call with a "category not in slot pool" error if the question's `category` is not in that resolved pool.
5. Snapshot `slot: { index, label }` onto the saved question record where `label` is taken from `format.questions[index].label` at the moment of write (NOT from the caller's `slot.label`, which is informational only).

When the active season has no `format`, the `save_question` tool SHALL reject any `slot` argument with a structured "season has no format" error.

#### Scenario: Save with valid slot succeeds and snapshots label

- **GIVEN** the active season has `format: { questions: [{ label: "GK 1" }, { label: "History Choice", categories: ["History"], questionTypes: { choice: 1 } }] }`
- **WHEN** `save_question` is called with `slot: { index: 1 }, category: "History", choices: [...], correctIndex: ...`
- **THEN** the call succeeds
- **AND** the saved question record carries `slot: { index: 1, label: "History Choice" }`

#### Scenario: Missing slot argument when format present

- **GIVEN** the active season has a `format`
- **WHEN** `save_question` is called without a `slot` argument
- **THEN** the call is rejected with a "slot required" error

#### Scenario: Slot index out of range

- **GIVEN** the active season has `format` with two slots (indices 0 and 1)
- **WHEN** `save_question` is called with `slot: { index: 2 }`
- **THEN** the call is rejected with a "slot index out of range" error

#### Scenario: Question type not permitted by slot

- **GIVEN** the active season's slot 1 has `questionTypes: { boolean: 0, choice: 1 }`
- **WHEN** `save_question` is called with `slot: { index: 1 }` for a boolean question (no `choices` arg)
- **THEN** the call is rejected with a "question type not permitted by slot" error

#### Scenario: Category not in slot's resolved pool

- **GIVEN** the active season has `categories: ["Science", "History", "Geography"]`
- **AND** slot 0 has `categories: ["History"]` (slot narrows the pool)
- **WHEN** `save_question` is called with `slot: { index: 0 }, category: "Science"`
- **THEN** the call is rejected with a "category not in slot pool" error

#### Scenario: Slot argument rejected when season has no format

- **GIVEN** the active season has no `format` field
- **WHEN** `save_question` is called with any `slot` argument
- **THEN** the call is rejected with a "season has no format" error

### Requirement: Season-finale section in reveal flow

When `seasons.enabled` is `true` AND the `process_reveal_answers` tool's returned `seasonStatus.isLastFireOfSeason` is `true` for the active game, the reveal flow SHALL render an additional **season-finale section** above the leaderboard table. The finale section SHALL summarize the closing season — its slug (from `seasonStatus.currentSlug`), the season MVP (from `seasonStatus.mvp`, populated by the tool from the current-season-ordered leaderboard), and a brief Game-Show-Presenter wrap-up paragraph in the persona's voice. The finale SHALL NOT preview the next season's slug, even when `seasonStatus.newSeasonStarted` is present — that's left to a subsequent reveal to announce.

When `seasonStatus.isLastFireOfSeason` is `false` (or `seasonStatus` is absent because seasons are disabled), no finale section is rendered.

Season-end rollover (stamping `endedAt` on the closing season and, when no continuation is queued, creating a new starter season) SHALL happen INSIDE `process_reveal_answers` before the tool returns. The reveal renderer SHALL NOT call `upsert_season` as a follow-up step. The outcome of any rollover SHALL be reported in `seasonStatus.seasonClosed` and `seasonStatus.newSeasonStarted` for informational use by the renderer.

#### Scenario: Mid-season reveal has no finale

- **GIVEN** `seasons.enabled` is `true` and `seasonStatus.isLastFireOfSeason` is `false` in the returned payload
- **WHEN** the reveal flow completes
- **THEN** the posted reveal contains no "season finale" header, paragraph, or MVP callout

#### Scenario: Season-end reveal includes finale before leaderboard

- **GIVEN** `seasons.enabled` is `true` and `seasonStatus.isLastFireOfSeason` is `true` in the returned payload
- **WHEN** the reveal flow completes
- **THEN** the posted reveal contains a section announcing the closing season's slug and naming the MVP from `seasonStatus.mvp`
- **AND** the section appears above the 3-row leaderboard table
- **AND** `process_reveal_answers` already stamped `endedAt` on the closing season before returning (the renderer does NOT call `upsert_season`)
- **AND** the renderer does NOT preview the new season's slug, even when `seasonStatus.newSeasonStarted` is present

### Requirement: 3-row dual-totals leaderboard rendering

When the payload returned by `process_reveal_answers` includes a `seasonStatus` field (which the tool populates when and only when `trivia.seasons.enabled === true` AND a current season exists for the game), the leaderboard `table` parameter passed to `submit_response` at reveal time SHALL be a 3-row table:

- **Row 1** — empty top-left cell, then one cell per player containing the player's `displayName` (NO medal prefix on this row).
- **Row 2** — left cell text `"Current Season"`, then one cell per player containing `currentSeasonCorrect` as a string, with medal prefix `🥇 `, `🥈 `, `🥉 ` (Unicode characters, not Slack shortcodes) on the player(s) holding the top-3 current-season scores.
- **Row 3** — left cell text `"All Time"`, then one cell per player containing `totalCorrect` as a string, with medal prefix `🥇 `, `🥈 `, `🥉 ` on the player(s) holding the top-3 all-time scores. The all-time medal assignment SHALL be independent of the current-season medal assignment.

Column order SHALL be by `currentSeasonCorrect` descending; ties SHALL be broken by `totalCorrect` descending. This ordering is already applied by the shared `computeLeaderboard` helper that the tool calls — the renderer SHALL NOT re-sort.

Players who have not participated in the current season (i.e., `currentSeasonCorrect === 0` AND `currentSeasonAnswered === 0`) SHALL be omitted from the table.

`column_settings` SHALL contain one entry per column with `{ "align": "center" }`. Where fewer than 3 players exist in the current season, medals SHALL be assigned in order to whichever players exist.

When the payload's `seasonStatus` field is absent (seasons disabled OR a current-season gap), the leaderboard SHALL render as the prior 2-row form (names row + scores row).

#### Scenario: Three-or-more-player season-active reveal

- **GIVEN** the current season has at least three players with non-zero participation
- **AND** Alice has `currentSeasonCorrect: 5, totalCorrect: 20`
- **AND** Bob has `currentSeasonCorrect: 2, totalCorrect: 25`
- **AND** Carol has `currentSeasonCorrect: 1, totalCorrect: 8`
- **WHEN** the reveal renders the leaderboard
- **THEN** the table has 3 rows × 4 columns
- **AND** row 1 is `["", "Alice", "Bob", "Carol"]` (no medals on the names row)
- **AND** row 2 is `["Current Season", "🥇 5", "🥈 2", "🥉 1"]`
- **AND** row 3 is `["All Time", "🥈 20", "🥇 25", "🥉 8"]` (Bob is the all-time #1 despite Alice's current-season #1)

#### Scenario: Player with 0 current-season is omitted

- **GIVEN** Dave has `currentSeasonCorrect: 0`, `currentSeasonAnswered: 0`, `totalCorrect: 50`
- **WHEN** the reveal renders the leaderboard
- **THEN** Dave does NOT appear as a column

#### Scenario: Fewer than three current-season players

- **GIVEN** only two players have current-season participation: Alice (5) and Bob (2)
- **WHEN** the reveal renders the leaderboard
- **THEN** the Current Season row is `["Current Season", "🥇 5", "🥈 2"]` (no 🥉)
- **AND** the All Time row uses medals only for the all-time top 2 among present players

#### Scenario: Seasons disabled retains 2-row leaderboard

- **GIVEN** `seasons.enabled` is `false`
- **WHEN** the reveal renders the leaderboard
- **THEN** the table has 2 rows (names + scores)
- **AND** no "Current Season" / "All Time" labels appear

### Requirement: Lazy per-game season bootstrap

Per-game seasons bootstrap SHALL happen lazily on first use of a game's `seasons.json` rather than at plugin-load time. The previous plugin-load-time bootstrap (which created `data/plugins/trivia/seasons.json` once) is removed.

When any tool resolves a `game` argument AND `trivia.seasons.enabled` is `true` AND the named game's `data/plugins/trivia/games/<game>/seasons.json` is missing, the plugin SHALL seed that file with exactly one entry whose:

- `slug` is computed deterministically as `season-YYYY-MM` based on the current UTC month.
- `startedAt` is `Date.now()`.
- `expectedEndAt` is end-of-current-UTC-month.
- `categories` is a copy of the global `categories.json`.

Pre-migration data moved into the per-game directory layout by migration 019 (whether the destination is `legacy-<channel>`, an existing config entry, or the fallback `initialgame`) is NOT backfilled with a `season` field — those entries remain untagged and contribute to all-time totals only.

#### Scenario: First per-game tool call seeds seasons.json

- **GIVEN** `trivia.seasons.enabled` is `true` and `games/staging/seasons.json` does not exist
- **WHEN** `get_ideas` is called with `game: "staging"`
- **THEN** `games/staging/seasons.json` is created with one starter entry before `get_ideas` returns

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
- **AND** the instruction does NOT reference `start_new_season` (obsolete)

#### Scenario: Instruction omits timeline guidance when seasons disabled

- **GIVEN** `seasons.enabled` is `false`
- **WHEN** a session loads the `trivia-check` instruction
- **THEN** the resolved instruction text does NOT reference any timeline tools
