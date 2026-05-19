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

1. Slug uniqueness *within this game's `seasons` array*. Two different games MAY use the same slug for their own seasons; the namespaces are independent.
2. Each entry satisfies `startedAt < (endedAt ?? expectedEndAt)`.
3. Each entry's `categories` array is non-empty.
4. No two entries' active windows `[startedAt, endedAt ?? expectedEndAt)` overlap *within the same game*.

Per-game `seasons.json` files SHALL be created lazily — when any tool resolves `game = "X"` and finds no `games/X/seasons.json` while `trivia.seasons.enabled` is `true`, the plugin SHALL seed a starter season into that file before continuing. The starter entry's `slug` is `season-YYYY-MM` (current UTC month), `startedAt` is `Date.now()`, `expectedEndAt` is end-of-current-UTC-month, and `categories` is a copy of the global `categories.json`.

The "current season" of a game at any moment is a *derived* concept: the unique entry in that game's `seasons.json` where `startedAt <= now < (endedAt ?? expectedEndAt)`, or `null` if `now` falls in a gap.

#### Scenario: Lazy bootstrap on first per-game tool call

- **GIVEN** `config.trivia.games[]` contains `{ name: "staging", enabled: true, ... }`
- **AND** `trivia.seasons.enabled` is `true`
- **AND** `data/plugins/trivia/games/staging/seasons.json` does NOT exist
- **AND** the global `categories.json` contains baseline entries
- **WHEN** any per-game tool (e.g. `get_ideas`) is called with `game: "staging"`
- **THEN** `data/plugins/trivia/games/staging/seasons.json` is created before the tool returns
- **AND** the file contains a `seasons` array with exactly one entry
- **AND** the entry's `slug` is non-empty, `startedAt < expectedEndAt`, and `categories` is a copy of the global `categories.json`

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
- **WHEN** `now` is `June-1`
- **THEN** `findCurrentSeason(games/main/seasons.json, now)` returns `null`

#### Scenario: Upsert with existing slug is an UPDATE within a game

- **GIVEN** `games/main/seasons.json` contains `{ slug: "summer-2026", ... }`
- **WHEN** `upsert_season` is called with `game: "main", slug: "summer-2026", ...`
- **THEN** the call is treated as an UPDATE of the existing entry

### Requirement: check_season_status tool

When `seasons.enabled` is `true`, the Trivia plugin SHALL expose a `check_season_status` MCP tool gated to the `admin` role.

The tool SHALL accept a required `game: string` argument, validated against `config.trivia.games[]` per the `trivia-games` capability. Read tool — succeeds against `enabled: false` games. The tool's analysis SHALL be scoped exclusively to `data/plugins/trivia/games/<game>/seasons.json` (lazy-seeded if missing).

The tool SHALL return `currentSlug`, `currentExpectedEndAt`, `isLastFireOfSeason`, `nextSeasonSlug`, `nextSeasonStartsAt`, and `isInGap`, all computed against the named game's timeline.

#### Scenario: Mid-season call within a game

- **GIVEN** `games/main/seasons.json` has one active season and no future seasons
- **WHEN** `check_season_status` is called with `game: "main"` mid-season
- **THEN** `currentSlug` and `currentExpectedEndAt` reflect the active season
- **AND** `nextSeasonSlug` and `nextSeasonStartsAt` are `null`
- **AND** `isInGap` is `false`

#### Scenario: Other games' timelines do not influence the result

- **GIVEN** `games/main/seasons.json` is in a gap but `games/sandbox/seasons.json` has an active season
- **WHEN** `check_season_status` is called with `game: "main"`
- **THEN** the response reflects only the `main` timeline (gap)

#### Scenario: Unknown game rejected

- **WHEN** `check_season_status` is called with `game: "ghost"`
- **THEN** the tool returns a structured "unknown game" error

#### Scenario: Tool is gated to admin

- **WHEN** a session's user has role below `admin`
- **THEN** `check_season_status` is absent from the session's MCP catalog

### Requirement: upsert_season tool

When `seasons.enabled` is `true`, the Trivia plugin SHALL expose an `upsert_season` MCP tool gated to the `admin` role that creates a new season or updates an existing one within a specified game.

The tool SHALL accept a required `game: string` argument validated against `config.trivia.games[]`. Unknown name → structured "unknown game" error; `enabled: false` entry → structured "game is disabled" error (write tool).

The tool SHALL further accept `slug` (required, kebab-case), `startedAt` (optional ms timestamp), `expectedEndAt` (optional ms timestamp), `endedAt` (optional ms timestamp), and `categories` (optional string array).

Per-game invariants:
- Slug uniqueness within the named game's timeline (collisions across games are OK).
- No-overlap within the named game's timeline.
- `startedAt` of an already-started season cannot be mutated.
- `categories` array non-empty.

When `categories` is provided and non-empty, the resulting entry's pool is exactly that list (replace, deduped). When `categories` is omitted or empty, the entry's pool is copied from the global `categories.json`. `categories` is only used on CREATE; on UPDATE, use `add_categories` / `remove_categories` with `target: <slug>`.

#### Scenario: Create a themed future season within a game

- **GIVEN** `games/main/seasons.json` contains only "may-2026"
- **WHEN** `upsert_season` is called with `game: "main", slug: "june-2026", startedAt: <June 1>, expectedEndAt: <June 30>, categories: [...themed entries]`
- **THEN** the response is `{ game: "main", slug: "june-2026", action: "created", ... }`
- **AND** "june-2026"'s `categories` equals exactly the provided list

#### Scenario: Create a non-themed season copies baseline

- **GIVEN** the global `categories.json` contains baseline entries
- **WHEN** `upsert_season` is called with `game: "main", slug: "july-2026", startedAt: <Jul 1>, expectedEndAt: <Jul 31>` (no categories)
- **THEN** the new entry's `categories` is a copy of the global `categories.json`

#### Scenario: Update an existing season's endedAt

- **GIVEN** the active "may-2026" in `games/main/seasons.json` has no `endedAt`
- **WHEN** `upsert_season` is called with `game: "main", slug: "may-2026", endedAt: <now>`
- **THEN** the entry's `endedAt` is set
- **AND** `findCurrentSeason(games/main/seasons.json, now)` no longer returns "may-2026"

#### Scenario: Overlap rejection within a game

- **GIVEN** `games/main/seasons.json` contains "may-2026" and "june-2026"
- **WHEN** `upsert_season("main", "may-2026", expectedEndAt: <overlaps june>)` is called
- **THEN** the call is rejected with an overlap error

#### Scenario: Cannot mutate startedAt of an already-started season

- **GIVEN** the active "may-2026" has `startedAt: <April 24>`
- **WHEN** `upsert_season("main", "may-2026", startedAt: <April 26>)` is called
- **THEN** the call is rejected with a "cannot shift the past" error

#### Scenario: Unknown game rejected

- **WHEN** `upsert_season` is called with `game: "ghost"`
- **THEN** the tool returns a structured "unknown game" error

#### Scenario: Disabled game refuses upsert

- **GIVEN** `config.trivia.games[]` contains `{ name: "retired", enabled: false, ... }`
- **WHEN** `upsert_season` is called with `game: "retired"` and otherwise-valid args
- **THEN** the tool returns a structured "game is disabled" error

#### Scenario: Invalid slug rejected

- **WHEN** `upsert_season` is called with `game: "main"` and `slug: "Has Spaces"` or `""`
- **THEN** the call is rejected with a slug-format error

#### Scenario: Tool is gated to admin

- **WHEN** a session's user has role below `admin`
- **THEN** `upsert_season` is absent from the session's MCP catalog

### Requirement: delete_season tool

When `seasons.enabled` is `true`, the Trivia plugin SHALL expose a `delete_season` MCP tool gated to the `admin` role that removes an entry from a specified game's seasons timeline.

The tool SHALL accept a required `game: string` (validated against `config.trivia.games[]`; unknown → error, disabled → "game is disabled" error) and a required `slug: string`.

Reject if the slug does not match any entry in the named game's `seasons.json`, if the entry has already started (`startedAt <= now`), or if it is the only entry on the named game's timeline.

#### Scenario: Delete a not-yet-started future season

- **GIVEN** `games/main/seasons.json` contains active "may-2026" and queued "june-2026"
- **WHEN** `delete_season(game: "main", slug: "june-2026")` is called
- **THEN** the call succeeds; `games/main/seasons.json` no longer contains "june-2026"

#### Scenario: Cannot delete the current season

- **GIVEN** the active "may-2026" has `startedAt <= now`
- **WHEN** `delete_season(game: "main", slug: "may-2026")` is called
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

When `seasons.enabled` is `true`, the Trivia plugin SHALL expose a `list_seasons` MCP tool gated to the `admin` role that returns every entry on a specified game's timeline.

The tool SHALL accept a required `game: string` argument validated against `config.trivia.games[]`. Read tool — succeeds against `enabled: false` games. The tool's analysis SHALL be scoped exclusively to `data/plugins/trivia/games/<game>/seasons.json` (lazy-seeded if missing).

Returns `{ game, seasons: [...], total }`. Each entry includes its full `categories` array and a derived `status: "past" | "current" | "future"`.

#### Scenario: Returns every timeline entry for the named game

- **GIVEN** `games/main/seasons.json` contains a past season, the active season, and a queued future season
- **WHEN** `list_seasons` is invoked with `game: "main"`
- **THEN** the response includes all three entries with correct `status` flags
- **AND** no entries from `games/sandbox/seasons.json` appear

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

When `seasons.enabled` is `true` AND `findCurrentSeason(games/<game>/seasons.json, now)` returns a season, the Trivia plugin SHALL stamp `season: <currentSlug>` onto every newly-written record in that game's `questions.json`, `answers.json`, and `cheats.json`.

When `findCurrentSeason` returns `null` (gap) for the game's timeline, new records SHALL NOT carry a `season` field.

The global `users.json` and `categories.json` SHALL NOT carry a `season` field.

#### Scenario: save_question stamps season from the named game's timeline

- **GIVEN** the active season in `games/main/seasons.json` is `"may-2026"`
- **AND** the active season in `games/sandbox/seasons.json` is `"sandbox-launch"`
- **WHEN** `save_question` is called with `game: "main"`
- **THEN** the new entry in `games/main/questions.json` includes `season: "may-2026"`
- **AND** the entry does NOT include `season: "sandbox-launch"`

#### Scenario: submit_answers stamps season on each answer

- **GIVEN** the active season in `games/main/seasons.json` is `"may-2026"`
- **WHEN** `submit_answers` is called with `game: "main"` and records three answers
- **THEN** each entry in `games/main/answers.json` includes `season: "may-2026"`

#### Scenario: save_cheating stamps season from the named game's timeline

- **GIVEN** the active season in `games/main/seasons.json` is `"may-2026"`
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

### Requirement: Lazy per-game season bootstrap

Per-game seasons bootstrap SHALL happen lazily on first use of a game's `seasons.json` rather than at plugin-load time. The plugin-load-time bootstrap (which previously created `data/plugins/trivia/seasons.json` once) SHALL be removed.

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

When `seasons.enabled` is `true`, the instruction SHALL additionally include guidance for the season-management tools (`upsert_season(game, ...)`, `delete_season(game, slug)`, `list_seasons(game)`, `add_categories({ game, target: "<slug>" })`, `remove_categories({ game, target: "<slug>" })`), and the semantic that each game's timeline is independent.

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

#### Scenario: Instruction omits timeline guidance when seasons disabled

- **GIVEN** `seasons.enabled` is `false`
- **WHEN** a session loads the `trivia-check` instruction
- **THEN** the resolved instruction text does NOT reference any timeline tools
