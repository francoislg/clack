## ADDED Requirements

### Requirement: Games registry file

The Trivia plugin SHALL maintain a file `data/plugins/trivia/games.json` whose schema is:

```
[
  {
    "slug": string,                  // unique; matches ^[a-z0-9-]+$; length 1–32
    "description": string?,          // optional human-readable description
    "createdAt": number,             // unix-ms when the game was registered
    "disabled": boolean,             // soft-delete flag
    "disabledAt": number?            // unix-ms when disabled; absent when disabled is false
  }
]
```

The file SHALL be created on first boot (by the blocking migration) and maintained exclusively through the `create_game`, `disable_game`, and `enable_game` MCP tools after that.

Slug uniqueness across the array SHALL be enforced at write time by `create_game`.

#### Scenario: Registry file is created by migration on first boot

- **GIVEN** a deployment upgrading from a pre-games release with `data/plugins/trivia/{questions,answers,cheats}.json` present
- **WHEN** the trivia migration runs at startup
- **THEN** `data/plugins/trivia/games.json` is created with exactly one entry `{ slug: "main", description: "Default game", createdAt: <now>, disabled: false }`

#### Scenario: Registry file remains the single source of truth for game existence

- **WHEN** any tool resolves a `game` argument
- **THEN** it consults `games.json` to determine whether the slug is registered
- **AND** a non-registered slug results in a structured error from the tool

### Requirement: Slug format

A game slug SHALL match the regular expression `^[a-z0-9-]+$` and SHALL have a length between 1 and 32 characters inclusive. Slugs SHALL be unique across the registry.

#### Scenario: Valid slug accepted

- **WHEN** `create_game` is called with `slug: "main"`, `slug: "staging-feature-x"`, or `slug: "test-2026"`
- **THEN** the slug passes format validation

#### Scenario: Uppercase rejected

- **WHEN** `create_game` is called with `slug: "Main"` or `slug: "MAIN"`
- **THEN** the tool returns a structured slug-format error
- **AND** the registry is unchanged

#### Scenario: Whitespace rejected

- **WHEN** `create_game` is called with `slug: "has spaces"`
- **THEN** the tool returns a structured slug-format error

#### Scenario: Empty slug rejected

- **WHEN** `create_game` is called with `slug: ""`
- **THEN** the tool returns a structured slug-format error

#### Scenario: Slug over 32 chars rejected

- **WHEN** `create_game` is called with a slug longer than 32 characters
- **THEN** the tool returns a structured slug-format error

#### Scenario: Path-traversal characters rejected

- **WHEN** `create_game` is called with `slug: "../etc"` or `slug: "a/b"`
- **THEN** the tool returns a structured slug-format error

#### Scenario: Duplicate slug rejected

- **GIVEN** `games.json` already contains an entry with `slug: "sandbox"`
- **WHEN** `create_game` is called with `slug: "sandbox"`
- **THEN** the tool returns a structured "slug already exists" error
- **AND** the registry is unchanged

### Requirement: Per-game data directory layout

For every entry in the games registry, the Trivia plugin SHALL store that game's per-game data files under `data/plugins/trivia/games/<slug>/` with the file names `questions.json`, `answers.json`, `cheats.json`, and (when `trivia.seasons.enabled`) `seasons.json`.

These four files SHALL be the sole storage for that game's questions, answers, cheat reports, and season timeline. Cross-game reads and writes from one game's directory to another are forbidden.

`data/plugins/trivia/categories.json` and `data/plugins/trivia/users.json` SHALL remain at the trivia root and SHALL be global — shared by every game.

#### Scenario: New game creates its directory

- **WHEN** `create_game` is called with a new slug
- **THEN** `data/plugins/trivia/games/<slug>/` is created
- **AND** the directory contains empty seed files for `questions.json` and `answers.json`
- **AND** `cheats.json` is created on first cheat write (or seeded empty at create time)
- **AND** when `trivia.seasons.enabled` is `true`, `seasons.json` is seeded with a starter season

#### Scenario: Writes to one game do not appear in another's reads

- **GIVEN** two registered games `main` and `sandbox`
- **WHEN** `save_question` is called with `game: "sandbox"` and a valid question payload
- **THEN** the question is appended to `data/plugins/trivia/games/sandbox/questions.json`
- **AND** the question does NOT appear in `data/plugins/trivia/games/main/questions.json`
- **AND** `find_previous_questions` called with `game: "main"` does NOT return the sandbox question

#### Scenario: Categories and users are shared across games

- **GIVEN** `data/plugins/trivia/categories.json` contains `["Science", "History"]`
- **AND** `data/plugins/trivia/users.json` contains `U123` with `cheatAttempts: 2`
- **WHEN** `save_question(game: "sandbox", ...)` reads category validation
- **THEN** the call reads from the root-level `categories.json` (not a per-game copy)
- **AND** `save_cheating(game: "sandbox", cheaterUserId: "U123", ...)` increments `cheatAttempts` to `3` on the root-level `users.json`

### Requirement: Universal `game` argument on per-game tools

Every Trivia plugin MCP tool that reads or writes per-game data SHALL accept a required `game: string` argument. Each such tool SHALL, on every invocation, resolve the slug against the games registry and:

1. Return a structured "unknown game" error if the slug is not present in `games.json`.
2. Return a structured "game is disabled" error if the slug is present but `disabled: true` AND the tool is a write tool (defined below).
3. Otherwise, route all per-game I/O through `data/plugins/trivia/games/<slug>/`.

The per-game tools SHALL be: `get_ideas`, `save_question`, `find_previous_questions`, `get_question_history`, `submit_answers`, `retrieve_scores`, `save_cheating`. When `trivia.seasons.enabled` is `true`, additionally: `check_season_status`, `upsert_season`, `delete_season`, `list_seasons`.

Write tools (subject to disabled-game refusal) SHALL be: `save_question`, `submit_answers`, `save_cheating`, `upsert_season`, `delete_season`. All other per-game tools are read-only and SHALL succeed against disabled games (frozen-archive semantics).

#### Scenario: Unknown game rejected on read

- **GIVEN** `games.json` contains only `main`
- **WHEN** `find_previous_questions` is called with `game: "ghost"` and any other valid args
- **THEN** the tool returns a structured "unknown game" error
- **AND** no I/O occurs against any `games/*/` directory

#### Scenario: Unknown game rejected on write

- **GIVEN** `games.json` contains only `main`
- **WHEN** `save_question` is called with `game: "ghost"` and otherwise-valid args
- **THEN** the tool returns a structured "unknown game" error
- **AND** no file is created or modified

#### Scenario: Disabled game refuses writes

- **GIVEN** `games.json` contains `{ slug: "retired-2025", disabled: true }`
- **WHEN** `save_question` is called with `game: "retired-2025"` and otherwise-valid args
- **THEN** the tool returns a structured "game is disabled" error
- **AND** `data/plugins/trivia/games/retired-2025/questions.json` is unchanged

#### Scenario: Disabled game allows reads (frozen archive)

- **GIVEN** `games.json` contains `{ slug: "retired-2025", disabled: true }`
- **AND** `data/plugins/trivia/games/retired-2025/questions.json` contains historical entries
- **WHEN** `find_previous_questions` is called with `game: "retired-2025", text: "..."`
- **THEN** the tool returns matching historical entries
- **AND** `retrieve_scores` with `game: "retired-2025"` returns the historical leaderboard

#### Scenario: Missing game argument rejected

- **WHEN** any per-game tool is called without a `game` argument
- **THEN** Zod schema validation fails before any handler logic runs

### Requirement: list_games tool

The Trivia plugin SHALL expose a `list_games` MCP tool gated to the `member` role that returns the games registry. The tool SHALL accept one optional argument:

- `includeDisabled` (boolean, optional, default `false`) — when `true`, disabled games are included in the response.

The tool SHALL return:

```
{
  games: Array<{
    slug: string,
    description: string | null,
    createdAt: number,
    disabled: boolean,
    disabledAt: number | null
  }>,
  total: number
}
```

Entries SHALL be returned in their stored order (registration order).

#### Scenario: Default response excludes disabled games

- **GIVEN** `games.json` contains `main` (enabled) and `retired-2025` (disabled)
- **WHEN** `list_games` is called with no arguments
- **THEN** the response contains exactly one entry with `slug: "main"`
- **AND** `total` is 1

#### Scenario: includeDisabled returns the full registry

- **GIVEN** `games.json` contains `main` (enabled) and `retired-2025` (disabled)
- **WHEN** `list_games` is called with `includeDisabled: true`
- **THEN** the response contains both entries
- **AND** `total` is 2
- **AND** each entry preserves its `disabled` and `disabledAt` fields

#### Scenario: Empty registry returns empty array

- **GIVEN** `games.json` is `[]`
- **WHEN** `list_games` is called
- **THEN** the response is `{ games: [], total: 0 }`

#### Scenario: Tool is gated to member

- **WHEN** a session's user has role `member` or higher
- **THEN** `list_games` appears in the session's MCP catalog

### Requirement: create_game tool

The Trivia plugin SHALL expose a `create_game` MCP tool gated to the `admin` role that registers a new game. The tool SHALL accept:

- `slug` (string, required) — must satisfy the slug format requirement; must not already exist in the registry.
- `description` (string, optional) — a free-form human-readable note.

The tool SHALL:

1. Validate the slug format and uniqueness against the current registry.
2. Append `{ slug, description, createdAt: <now>, disabled: false }` to `games.json`.
3. Create `data/plugins/trivia/games/<slug>/` with empty seed files `questions.json: []` and `answers.json: []`.
4. When `trivia.seasons.enabled` is `true`, also seed `data/plugins/trivia/games/<slug>/seasons.json` with a starter season entry whose `slug` is computed deterministically (`season-YYYY-MM` based on the current UTC month), whose `startedAt` is `Date.now()`, whose `expectedEndAt` is the end of the current UTC month, and whose `categories` is a copy of `data/plugins/trivia/categories.json`.

Return shape: `{ slug, createdAt, seasonsBootstrapped: boolean }`.

#### Scenario: Create a new game with seasons disabled

- **GIVEN** `trivia.seasons.enabled` is `false`
- **WHEN** `create_game` is called with `slug: "sandbox", description: "test channel"`
- **THEN** `games.json` gains a new entry `{ slug: "sandbox", description: "test channel", createdAt: ..., disabled: false }`
- **AND** `data/plugins/trivia/games/sandbox/{questions,answers}.json` exist as empty arrays
- **AND** `data/plugins/trivia/games/sandbox/seasons.json` does NOT exist
- **AND** the response is `{ slug: "sandbox", createdAt: ..., seasonsBootstrapped: false }`

#### Scenario: Create a new game with seasons enabled

- **GIVEN** `trivia.seasons.enabled` is `true`
- **AND** `categories.json` contains 30 baseline entries
- **WHEN** `create_game` is called with `slug: "staging"`
- **THEN** `games.json` gains the new entry
- **AND** `data/plugins/trivia/games/staging/seasons.json` is created with a single starter season whose `categories` is the 30-entry baseline copy
- **AND** the response is `{ slug: "staging", createdAt: ..., seasonsBootstrapped: true }`

#### Scenario: Tool is gated to admin

- **WHEN** a session's user has role below `admin`
- **THEN** `create_game` is absent from the session's MCP catalog

### Requirement: disable_game tool

The Trivia plugin SHALL expose a `disable_game` MCP tool gated to the `admin` role that soft-deletes a game by setting `disabled: true` and `disabledAt: <now>` on its registry entry. The tool SHALL accept:

- `slug` (string, required) — must match an existing registry entry.

The tool SHALL:

1. Reject the call if `slug` is not present in `games.json` (structured "unknown game" error).
2. Reject the call if the entry is already `disabled: true` (structured "already disabled" error).
3. Otherwise, set `disabled: true` and `disabledAt: <now>` on the entry and persist.

No data files SHALL be deleted or moved by this tool. The game's `games/<slug>/` directory is left intact.

#### Scenario: Disable an active game

- **GIVEN** `games.json` contains `{ slug: "retired-2025", disabled: false }`
- **WHEN** `disable_game` is called with `slug: "retired-2025"`
- **THEN** the entry is updated to `disabled: true, disabledAt: <now>`
- **AND** `data/plugins/trivia/games/retired-2025/` is unchanged

#### Scenario: Disable rejects unknown slug

- **WHEN** `disable_game` is called with `slug: "ghost"` and `ghost` is not in the registry
- **THEN** the tool returns a structured "unknown game" error

#### Scenario: Disable rejects already-disabled game

- **GIVEN** the entry for `retired-2025` already has `disabled: true`
- **WHEN** `disable_game` is called with `slug: "retired-2025"`
- **THEN** the tool returns a structured "already disabled" error

#### Scenario: Tool is gated to admin

- **WHEN** a session's user has role below `admin`
- **THEN** `disable_game` is absent from the session's MCP catalog

### Requirement: enable_game tool

The Trivia plugin SHALL expose an `enable_game` MCP tool gated to the `admin` role that reverses a soft-delete by clearing the `disabled` flag and removing the `disabledAt` field. The tool SHALL accept:

- `slug` (string, required) — must match an existing registry entry.

The tool SHALL:

1. Reject the call if `slug` is not present in `games.json`.
2. Reject the call if the entry is already `disabled: false` (structured "already enabled" error).
3. Otherwise, set `disabled: false` and clear `disabledAt` on the entry and persist.

#### Scenario: Enable a disabled game

- **GIVEN** `games.json` contains `{ slug: "retired-2025", disabled: true, disabledAt: 12345 }`
- **WHEN** `enable_game` is called with `slug: "retired-2025"`
- **THEN** the entry is updated to `disabled: false` and `disabledAt` is absent

#### Scenario: Enable rejects unknown slug

- **WHEN** `enable_game` is called with `slug: "ghost"` and `ghost` is not in the registry
- **THEN** the tool returns a structured "unknown game" error

#### Scenario: Enable rejects already-enabled game

- **GIVEN** the entry for `main` has `disabled: false`
- **WHEN** `enable_game` is called with `slug: "main"`
- **THEN** the tool returns a structured "already enabled" error

#### Scenario: Tool is gated to admin

- **WHEN** a session's user has role below `admin`
- **THEN** `enable_game` is absent from the session's MCP catalog

### Requirement: Migration from flat files to games/main/

A blocking boot migration SHALL detect a pre-existing flat-file layout under `data/plugins/trivia/` and migrate it into the per-game directory layout under a single `main` game. The migration SHALL:

1. Check whether `data/plugins/trivia/games.json` already exists. If yes, exit no-op (idempotent).
2. Otherwise, scan for legacy files: `data/plugins/trivia/{questions,answers,cheats,seasons}.json`.
3. Create `data/plugins/trivia/games/main/`.
4. Move any present legacy files into `data/plugins/trivia/games/main/` (preserving content byte-for-byte).
5. Write `data/plugins/trivia/games.json` with `[{ slug: "main", description: "Default game", createdAt: <now>, disabled: false }]`.

The migration SHALL NOT modify `categories.json` or `users.json`. The migration SHALL be idempotent: re-running on a deployment whose `games.json` already exists is a no-op.

#### Scenario: Migration on a populated deployment

- **GIVEN** a deployment with `data/plugins/trivia/{questions,answers,cheats,seasons}.json` and no `games.json`
- **WHEN** the migration runs at boot
- **THEN** the four flat files are moved into `data/plugins/trivia/games/main/` preserving content
- **AND** `data/plugins/trivia/games.json` is written with a single `main` entry
- **AND** `data/plugins/trivia/categories.json` and `data/plugins/trivia/users.json` are unchanged

#### Scenario: Migration on a fresh deployment

- **GIVEN** a deployment with no `questions.json`, `answers.json`, `cheats.json`, `seasons.json`, or `games.json`
- **WHEN** the migration runs at boot
- **THEN** `data/plugins/trivia/games.json` is created with a single `main` entry
- **AND** `data/plugins/trivia/games/main/` is created with empty `questions.json: []` and `answers.json: []`

#### Scenario: Migration is idempotent

- **GIVEN** the migration has already run once and `games.json` exists
- **WHEN** the migration runs again at a subsequent boot
- **THEN** no files are moved or created
- **AND** `games.json` is unchanged
