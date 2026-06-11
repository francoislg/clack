## MODIFIED Requirements

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
