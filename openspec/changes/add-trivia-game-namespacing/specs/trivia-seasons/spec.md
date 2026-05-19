## MODIFIED Requirements

### Requirement: seasons.json file schema

When `seasons.enabled` is `true`, the Trivia plugin SHALL maintain a `seasons.json` file inside each registered game's directory: `data/plugins/trivia/games/<game>/seasons.json`. Each game's timeline is independent. The schema of each file is:

```
{
  "seasons": Array<{
    "slug": string,           // unique within this game; non-empty kebab-case
    "startedAt": number,      // unix-ms when the season's active window begins
    "expectedEndAt": number,  // unix-ms when the season's active window is expected to close
    "endedAt": number?,       // unix-ms when the season was actually closed; absent for not-yet-ended seasons
    "categories": string[]    // the season's category pool (non-empty)
  }>
}
```

Invariants (enforced by `upsert_season` at write time, **per game**):

1. Slug uniqueness *within this game's `seasons` array* — no two entries in the same game share the same `slug`. Two different games MAY use the same slug for their own seasons; the namespaces are independent.
2. Each entry satisfies `startedAt < (endedAt ?? expectedEndAt)`.
3. Each entry's `categories` array is non-empty.
4. No two entries' active windows `[startedAt, endedAt ?? expectedEndAt)` overlap *within the same game*.

Per-game `seasons.json` files SHALL be created by `create_game` (when `trivia.seasons.enabled` is `true` at that time) with exactly one starter entry. Subsequent mutations flow exclusively through `upsert_season`, `delete_season`, `add_categories`, and `remove_categories`, all of which take a `game` argument.

The "current season" of a game at any moment is a *derived* concept: the unique entry in that game's `seasons.json` where `startedAt <= now < (endedAt ?? expectedEndAt)`, or `null` if `now` falls in a gap between entries.

#### Scenario: create_game seeds the new game's seasons.json when seasons are enabled

- **GIVEN** `trivia.seasons.enabled` is `true`
- **WHEN** `create_game` is called with `slug: "staging"`
- **THEN** `data/plugins/trivia/games/staging/seasons.json` is created before `create_game` returns
- **AND** the file contains a `seasons` array with exactly one entry
- **AND** the entry's `slug` is non-empty, `startedAt < expectedEndAt`, and `categories` is a copy of the global `categories.json`

#### Scenario: create_game does not seed seasons when feature is disabled

- **GIVEN** `trivia.seasons.enabled` is `false`
- **WHEN** `create_game` is called with `slug: "staging"`
- **THEN** `data/plugins/trivia/games/staging/seasons.json` does NOT exist

#### Scenario: No-overlap invariant is enforced within a game at write time

- **GIVEN** `games/main/seasons.json` contains an entry `{ slug: "may-2026", startedAt: T1, expectedEndAt: T3 }`
- **WHEN** `upsert_season` is called with `game: "main", slug: "june-2026", startedAt: T2, expectedEndAt: T4` where `T1 < T2 < T3 < T4` (overlap)
- **THEN** the tool returns a structured overlap error
- **AND** `games/main/seasons.json` is unchanged

#### Scenario: Same slug allowed across different games

- **GIVEN** `games/main/seasons.json` contains `{ slug: "season-2026-05", ... }`
- **WHEN** `upsert_season` is called with `game: "sandbox", slug: "season-2026-05", startedAt: <now>, expectedEndAt: <later>`
- **THEN** the call succeeds; `games/sandbox/seasons.json` now contains an entry with the same slug
- **AND** the two are independent records on independent timelines

#### Scenario: Back-to-back seasons are permitted (touching but not overlapping) within a game

- **GIVEN** `games/main/seasons.json` contains `{ slug: "may-2026", expectedEndAt: T }`
- **WHEN** `upsert_season` is called with `game: "main", slug: "june-2026", startedAt: T, expectedEndAt: T+30days`
- **THEN** the tool succeeds and the file gains the new entry

#### Scenario: Gap between seasons leaves current null within the game

- **GIVEN** `games/main/seasons.json` contains May with `expectedEndAt: May-31` and June with `startedAt: June-2`
- **WHEN** `now` is `June-1` (in the gap)
- **THEN** `findCurrentSeason(games/main/seasons.json, now)` returns `null`
- **AND** new question/answer/cheat writes to `games/main/*` during this window have no `season` field

#### Scenario: Slug uniqueness within a game is enforced (upsert with existing slug is an UPDATE)

- **GIVEN** `games/main/seasons.json` contains an entry with `slug: "summer-2026"`
- **WHEN** `upsert_season` is called with `game: "main", slug: "summer-2026"` and `startedAt`/`expectedEndAt` provided AS IF creating
- **THEN** the call is treated as an UPDATE of the existing entry, not as a duplicate-slug error
- **AND** the existing entry's other fields are updated per the call

### Requirement: check_season_status tool

When `seasons.enabled` is `true`, the Trivia plugin SHALL expose a `check_season_status` MCP tool gated to the `admin` role.

The tool SHALL accept a required `game: string` argument; the slug SHALL be validated against the games registry per the `trivia-games` capability (unknown slug → structured error). The tool SHALL succeed against disabled games (frozen-archive read). The tool's analysis SHALL be scoped exclusively to `data/plugins/trivia/games/<game>/seasons.json`.

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

The tool SHALL accept a required `game: string` argument; the slug SHALL be validated against the games registry per the `trivia-games` capability (unknown slug → structured error; disabled slug → structured "game is disabled" error, since upsert is a write).

The tool SHALL further accept:

- `slug` (string, required) — non-empty kebab-case identifier. Treated as immutable: if the slug already exists *within the named game's timeline*, the call is an update of that entry; otherwise the call creates a new entry. Slug renaming is not supported (use `delete_season` + a new `upsert_season` for a not-yet-started entry). Slugs may collide with slugs in other games' timelines without issue.
- `startedAt` (number, optional, unix-ms) — required on CREATE; on UPDATE, modifying it is rejected if the existing entry's `startedAt <= now` (the past is immutable).
- `expectedEndAt` (number, optional, unix-ms) — required on CREATE; on UPDATE, the new value MUST still satisfy `startedAt < (endedAt ?? newExpectedEndAt)`.
- `endedAt` (number, optional, unix-ms) — sets the actual end time. Used to mark a season as closed (e.g. at the last-fire reveal or for early termination by an admin).
- `categories` (string[], optional) — the season's category pool. When provided AND non-empty, the new season's pool is **exactly** that list (replace, not augment — for purely themed seasons). When omitted OR empty, the new season's pool is copied from the global `categories.json` (the persistent baseline). Used only on CREATE; ignored on UPDATE (use `add_categories` / `remove_categories` with `target: <slug>` to refine an existing season's pool).

The tool SHALL:

1. Validate that `slug` is non-empty kebab-case.
2. Load the named game's `seasons.json` (initialize from scratch if missing — same shape as create-game seeding).
3. If creating: require both `startedAt` and `expectedEndAt`. Categories source — if `categories` arg is provided AND non-empty, use exactly that list (deduped, preserving first-occurrence order); otherwise copy the global `categories.json`. Reject if the resulting list is empty. Verify the new entry's `[startedAt, endedAt ?? expectedEndAt)` interval does not overlap any existing entry's interval *within the same game*.
4. If updating: load the existing entry in the named game, apply the passed fields (omit-to-keep semantics), re-validate the same invariants (`startedAt < (endedAt ?? expectedEndAt)`, no overlap with other entries in this game excluding self, `categories` still non-empty), and reject any attempt to mutate `startedAt` of an already-started season.
5. Atomically write the new `games/<game>/seasons.json`.

Return shape: `{ game, slug, action: "created" | "updated", startedAt, expectedEndAt, endedAt, categoriesCount }`.

#### Scenario: Create a themed future season within a game (categories replace baseline)

- **GIVEN** `games/main/seasons.json` contains only the active "may-2026" season
- **WHEN** `upsert_season` is called with `game: "main", slug: "june-2026", startedAt: <June 1>, expectedEndAt: <June 30 23:59>, categories: ["Cephalopods", "Coral Reefs", "Tides", ...20 themed entries]`
- **THEN** the response is `{ game: "main", slug: "june-2026", action: "created", ... }`
- **AND** `games/main/seasons.json` now contains both seasons
- **AND** "june-2026"'s `categories` equals exactly the provided list (no baseline mixing)

#### Scenario: Create a non-themed season (omit categories → copy baseline)

- **GIVEN** the global `categories.json` contains 50 baseline entries
- **WHEN** `upsert_season` is called with `game: "main", slug: "july-2026", startedAt: <Jul 1>, expectedEndAt: <Jul 31 23:59>` (no `categories` arg)
- **THEN** the new entry's `categories` in `games/main/seasons.json` is a copy of the global `categories.json` (50 entries)

#### Scenario: Provided categories are deduped

- **GIVEN** the global `categories.json` contains `["Science", "History", "Geography"]`
- **WHEN** `upsert_season(game: "main", slug: "marine-2026-06", startedAt: <June 1>, expectedEndAt: <June 30>, categories: ["Cephalopods", "Cephalopods", "Tides"])` is called
- **THEN** the resulting entry's `categories` is `["Cephalopods", "Tides"]` — duplicates collapsed, baseline NOT mixed in
- **AND** the global `categories.json` remains unchanged

#### Scenario: Update a future season's expected end within a game

- **GIVEN** `games/main/seasons.json` contains a future "june-2026" season with `expectedEndAt: June-30`
- **WHEN** `upsert_season` is called with `game: "main", slug: "june-2026", expectedEndAt: <July 7>`
- **THEN** the response is `{ game: "main", slug: "june-2026", action: "updated", ... }`
- **AND** the entry's `expectedEndAt` is updated; its `startedAt` and `categories` are unchanged

#### Scenario: Update an existing season's endedAt (mark closed) within a game

- **GIVEN** the active "may-2026" season in `games/main/seasons.json` has no `endedAt`
- **WHEN** `upsert_season` is called with `game: "main", slug: "may-2026", endedAt: <now>`
- **THEN** the entry's `endedAt` is set to the provided value
- **AND** `findCurrentSeason(games/main/seasons.json, now)` no longer returns "may-2026" if `endedAt <= now`

#### Scenario: Overlap rejection on update (within a game)

- **GIVEN** `games/main/seasons.json` contains "may-2026" `[May-1, May-31]` and "june-2026" `[June-1, June-30]`
- **WHEN** `upsert_season(game: "main", slug: "may-2026", { expectedEndAt: <June 15> })` is called
- **THEN** the call is rejected with an overlap error (the proposed window overlaps june-2026 within `main`)
- **AND** `games/main/seasons.json` is unchanged

#### Scenario: Cannot mutate startedAt of an already-started season

- **GIVEN** the active "may-2026" season in `games/main/seasons.json` has `startedAt: <April 24>` (in the past)
- **WHEN** `upsert_season(game: "main", slug: "may-2026", { startedAt: <April 26> })` is called
- **THEN** the call is rejected with a "cannot shift the past" error
- **AND** `games/main/seasons.json` is unchanged

#### Scenario: Empty resulting pool rejected on create

- **GIVEN** the global `categories.json` is empty AND `categories` arg is omitted (or empty)
- **WHEN** `upsert_season` is called with `game: "main"` as a create
- **THEN** the call is rejected with a "season must have at least one category" error

#### Scenario: Unknown game rejected

- **WHEN** `upsert_season` is called with `game: "ghost"`
- **THEN** the tool returns a structured "unknown game" error
- **AND** no file is created or modified

#### Scenario: Disabled game refuses upsert

- **GIVEN** `games.json` marks `retired-2025` as `disabled: true`
- **WHEN** `upsert_season` is called with `game: "retired-2025"` and otherwise-valid args
- **THEN** the tool returns a structured "game is disabled" error

#### Scenario: Invalid slug rejected

- **WHEN** `upsert_season` is called with `game: "main"` and `slug: "Has Spaces"` or `"UPPER"` or `""`
- **THEN** the call is rejected with a slug-format error

#### Scenario: Tool is gated to admin

- **WHEN** a session's user has role below `admin`
- **THEN** `upsert_season` is absent from the session's MCP catalog

### Requirement: delete_season tool

When `seasons.enabled` is `true`, the Trivia plugin SHALL expose a `delete_season` MCP tool gated to the `admin` role that removes an entry from a specified game's seasons timeline.

The tool SHALL accept:

- `game` (string, required) — the game slug; validated against the games registry per the `trivia-games` capability (unknown slug → structured error; disabled slug → structured "game is disabled" error, since deletion is a mutating write).
- `slug` (string, required) — the slug of the season to delete *within the named game*.

The tool SHALL:

1. Reject the call if `slug` does not match any entry in the named game's `seasons.json` (404-style error).
2. Reject the call if the named entry's `startedAt <= now` (past and current seasons are immutable historical records).
3. Reject the call if the named entry is the only entry in the named game's timeline (each game requires at least one season to exist while `seasons.enabled` is `true`).
4. Otherwise, remove the named entry from `games/<game>/seasons.json#seasons`.

#### Scenario: Delete a not-yet-started future season

- **GIVEN** `games/main/seasons.json` contains active "may-2026" and queued "june-2026" `(startedAt: <June 1>, > now)`
- **WHEN** `delete_season(game: "main", slug: "june-2026")` is called
- **THEN** the call succeeds; `games/main/seasons.json#seasons` no longer contains "june-2026"
- **AND** `games/main/seasons.json`'s other entries are unchanged
- **AND** no other games' `seasons.json` files are touched

#### Scenario: Cannot delete the current season

- **GIVEN** the active "may-2026" season in `games/main/seasons.json` has `startedAt <= now`
- **WHEN** `delete_season(game: "main", slug: "may-2026")` is called
- **THEN** the call is rejected with a "season has already started" error
- **AND** `games/main/seasons.json` is unchanged

#### Scenario: Cannot delete a past season

- **GIVEN** `games/main/seasons.json` contains an old "spring-2026" entry with `endedAt < now`
- **WHEN** `delete_season(game: "main", slug: "spring-2026")` is called
- **THEN** the call is rejected with a "season has already started" error
- **AND** `games/main/seasons.json` is unchanged

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

The tool SHALL accept a required `game: string` argument; the slug SHALL be validated against the games registry per the `trivia-games` capability (unknown slug → structured error). The tool SHALL succeed against disabled games (frozen-archive read). The tool's analysis SHALL be scoped exclusively to `data/plugins/trivia/games/<game>/seasons.json`.

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

Entries SHALL be returned in their stored order (which, under the no-overlap invariant per game, is the natural timeline order by `startedAt`). The full `categories` array is included for every entry — this is an admin tool used to inspect what's queued and audit category pools.

#### Scenario: Returns every timeline entry for the named game with status flags

- **GIVEN** `games/main/seasons.json` contains a past season, the active season, and a queued future season
- **WHEN** `list_seasons` is invoked with `game: "main"`
- **THEN** the response includes all three entries from the `main` timeline
- **AND** the past entry's `status` is `"past"`
- **AND** the active entry's `status` is `"current"`
- **AND** the future entry's `status` is `"future"`
- **AND** each entry includes its full `categories` array
- **AND** no entries from `games/sandbox/seasons.json` appear in the response

#### Scenario: Missing seasons.json returns an error

- **WHEN** `list_seasons` is invoked with `game: "main"` and `games/main/seasons.json` is missing (e.g. seasons recently enabled and the game predates the flag)
- **THEN** the tool returns a structured error indicating seasons are not initialized for this game

#### Scenario: Unknown game rejected

- **WHEN** `list_seasons` is called with `game: "ghost"`
- **THEN** the tool returns a structured "unknown game" error

#### Scenario: Tool is gated to admin

- **WHEN** a session's user has role below `admin`
- **THEN** `list_seasons` is absent from the session's MCP catalog

### Requirement: Season tag on new records

When `seasons.enabled` is `true` AND `findCurrentSeason(games/<game>/seasons.json, now)` returns a season, the Trivia plugin SHALL stamp `season: <currentSlug>` onto every newly-written record in that game's `questions.json`, `answers.json`, and `cheats.json`. The `season` value SHALL be captured at the moment of write, so a record stamped during one season remains tagged with that slug even after the season has rolled over.

When `findCurrentSeason` returns `null` (timeline gap) for the game's timeline, new records in that game's files SHALL NOT carry a `season` field.

The global `users.json` and `categories.json` SHALL NOT carry a `season` field — users and categories span seasons by design.

#### Scenario: save_question stamps season from the named game's timeline

- **GIVEN** the currently-active season's slug in `games/main/seasons.json` is `"may-2026"`
- **AND** the currently-active season's slug in `games/sandbox/seasons.json` is `"sandbox-launch"`
- **WHEN** `save_question` is called with `game: "main"` and valid arguments
- **THEN** the new entry in `games/main/questions.json` includes `season: "may-2026"`
- **AND** the entry does NOT include `season: "sandbox-launch"`

#### Scenario: submit_answers stamps season on each answer from the named game's timeline

- **GIVEN** the currently-active season's slug in `games/main/seasons.json` is `"may-2026"`
- **WHEN** `submit_answers` is called with `game: "main"` and records three new answer entries
- **THEN** each entry in `games/main/answers.json` includes `season: "may-2026"`

#### Scenario: save_cheating stamps season from the named game's timeline

- **GIVEN** the currently-active season's slug in `games/main/seasons.json` is `"may-2026"`
- **WHEN** `save_cheating` is called with `game: "main"` and records a cheat
- **THEN** the entry in `games/main/cheats.json` includes `season: "may-2026"`

#### Scenario: Writes during a gap have no season tag

- **GIVEN** `findCurrentSeason(games/main/seasons.json, now)` returns `null`
- **WHEN** any tag-stamping tool writes a new entry with `game: "main"`
- **THEN** the new entry contains no `season` field

#### Scenario: Disabled config skips tagging

- **GIVEN** `seasons.enabled` is `false`
- **WHEN** any tool writes to a game's `questions.json`, `answers.json`, or `cheats.json`
- **THEN** no `season` field is present on the new records

### Requirement: First-enable plugin initialization

Per-game season bootstrap SHALL happen at `create_game` time rather than at plugin-load time. The plugin SHALL NOT create or modify any per-game `seasons.json` file during its load function.

When `create_game` is called AND `trivia.seasons.enabled` is `true`, the tool SHALL seed the new game's `data/plugins/trivia/games/<slug>/seasons.json` with exactly one entry whose:

- `slug` is computed deterministically as `season-YYYY-MM` (based on the current UTC month).
- `startedAt` is `Date.now()`.
- `expectedEndAt` is end-of-current-UTC-month (`23:59:59.999`).
- `categories` is a copy of the current global `categories.json` (the persistent baseline pool).

Pre-existing entries in the migrated `games/main/{questions,answers,cheats}.json` are NOT backfilled with a `season` field — they remain untagged and contribute to all-time totals only.

#### Scenario: First create_game after enabling seasons seeds the new game's seasons.json

- **GIVEN** `trivia.seasons.enabled` is `true`
- **AND** the global `categories.json` exists with baseline entries
- **WHEN** `create_game` is called for a new slug `staging`
- **THEN** `games/staging/seasons.json` is created with `seasons: [{ slug: "season-<YYYY>-<MM>", ... }]` matching the current UTC month
- **AND** the `categories` array on that entry is a copy of the global `categories.json`

#### Scenario: Pre-migration data remains untagged in games/main/

- **GIVEN** a deployment whose flat-file data was migrated into `games/main/{questions,answers,cheats}.json`
- **AND** `trivia.seasons.enabled` is enabled after the migration runs
- **AND** `create_game` is not used for `main` (it was registered by the migration itself)
- **WHEN** any tool reads the migrated entries
- **THEN** the entries continue to have no `season` field (their pre-migration state)
- **AND** they contribute to game-all-time totals only

#### Scenario: Re-enabling seasons does not re-seed existing games

- **GIVEN** `games/main/seasons.json` already exists
- **WHEN** the app boots again with `trivia.seasons.enabled` still `true`
- **THEN** no bootstrap fires for `main`
- **AND** `games/main/seasons.json` is unchanged

### Requirement: trivia-check instruction advertises timeline management

When `seasons.enabled` is `true`, the `trivia-check` instruction registered by the Trivia plugin SHALL include guidance directing admins how to manage each game's timeline. The instruction SHALL reference:

- `upsert_season(game, ...)` for preparing future seasons in a specific game (and updating not-yet-started ones).
- `delete_season(game, slug)` for retracting a not-yet-started future season in a specific game.
- `list_seasons(game)` for inspecting the full timeline of a specific game.
- `add_categories({ game, target: "<slug>" })` / `remove_categories({ game, target: "<slug>" })` for editing a queued season's pool after creation.
- The semantics that `categories` on `upsert_season` REPLACES the baseline (for themed seasons); omitting it copies the global `categories.json`.
- That each game's timeline is independent — operating on `main` does not affect `sandbox`.

When `seasons.enabled` is `false`, the instruction SHALL NOT include this guidance.

#### Scenario: Instruction includes timeline guidance when enabled

- **GIVEN** `seasons.enabled` is `true`
- **WHEN** a session loads the `trivia-check` instruction
- **THEN** the resolved instruction text references `upsert_season`, `delete_season`, and `list_seasons` by name
- **AND** the resolved text references the `game` argument required by each season tool
- **AND** the resolved text does NOT reference `start_new_season` (obsolete)

#### Scenario: Instruction omits guidance when disabled

- **GIVEN** `seasons.enabled` is `false`
- **WHEN** a session loads the `trivia-check` instruction
- **THEN** the resolved instruction text does NOT reference any timeline tools
