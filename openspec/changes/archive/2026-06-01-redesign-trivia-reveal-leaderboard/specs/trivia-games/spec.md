## ADDED Requirements

### Requirement: allTimeRow field on TriviaGame and workspace

`TriviaGame` (entries in `config.trivia.games[]`) AND the workspace tier (`config.trivia`) SHALL each accept an optional `allTimeRow: "always" | "never" | "end-of-season-only"` field. The value participates in the `allTimeRow` cascade resolved at reveal time (cascade order: `game → workspace → default("end-of-season-only")`) — there is no season or slot tier. It governs the All-Time leaderboard surface (the normal-reveal `All Time` row and the season-finale All-Time table), per `trivia-seasons`.

The field SHALL be parsed with the following rules:

- Absence is valid — the cascade falls through to workspace config and ultimately to the `"end-of-season-only"` default.
- Values other than the three string literals SHALL be rejected with a logged warning naming the tier (and game, at the game tier) and the violating value; the field SHALL then be treated as absent.
- The value SHALL be exposed on the parsed `TriviaGame` / `TriviaConfig` shapes so the cascade resolver can read it.

The `upsert_game` and `set_workspace_config` MCP tools SHALL accept `allTimeRow` as an optional argument (one of the three literals), persisting it on the game entry / workspace config respectively. Consistent with other optional fields, an explicit `null` SHALL clear a previously-set value, and omission SHALL preserve the existing value.

The `list_games` tool SHALL surface `allTimeRow` per-game when set (omitted from the entry when absent — no default injection at read time) and SHALL surface `workspaceDefaults.allTimeRow` IF AND ONLY IF `config.trivia.allTimeRow` is set in the loaded config.

#### Scenario: Absent field cascades to workspace then default

- **GIVEN** `config.trivia.games[]` has `{ name: "main", ... }` (no `allTimeRow`)
- **AND** `config.trivia` has no `allTimeRow`
- **WHEN** the reveal flow resolves the cascade for `main`
- **THEN** the resolved value is `"end-of-season-only"` (the built-in default)

#### Scenario: Game-level value beats workspace

- **GIVEN** `config.trivia.games[]` has `{ name: "main", allTimeRow: "always", ... }`
- **AND** `config.trivia.allTimeRow: "never"`
- **WHEN** the reveal flow resolves the cascade for `main`
- **THEN** the resolved value is `"always"`

#### Scenario: Invalid value is rejected

- **GIVEN** `config.trivia.games[]` has `{ name: "main", allTimeRow: "sometimes", ... }`
- **WHEN** the config is parsed
- **THEN** a warning is logged identifying the game and the invalid value
- **AND** the parsed game has no `allTimeRow` field (treated as absent)

#### Scenario: upsert_game persists allTimeRow

- **WHEN** `upsert_game({ name: "main", allTimeRow: "always" })` is called
- **THEN** the game entry is persisted with `allTimeRow: "always"`

#### Scenario: set_workspace_config persists allTimeRow

- **WHEN** `set_workspace_config({ allTimeRow: "never" })` is called
- **THEN** `config.trivia.allTimeRow` is persisted as `"never"`

#### Scenario: list_games surfaces the field when set

- **GIVEN** a game with `allTimeRow: "always"` and `config.trivia.allTimeRow: "end-of-season-only"`
- **WHEN** `list_games` runs
- **THEN** the per-game entry includes `allTimeRow: "always"`
- **AND** `workspaceDefaults.allTimeRow` is `"end-of-season-only"`

#### Scenario: list_games omits the field when absent

- **GIVEN** a game without an explicit `allTimeRow` and `config.trivia` without `allTimeRow`
- **WHEN** `list_games` runs
- **THEN** the per-game entry does NOT include an `allTimeRow` field
- **AND** `workspaceDefaults.allTimeRow` is absent
