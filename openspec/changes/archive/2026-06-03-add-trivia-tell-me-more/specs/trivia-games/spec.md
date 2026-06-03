## ADDED Requirements

### Requirement: tellMeMore field on TriviaGame and workspace

`TriviaGame` (entries in `config.trivia.games[]`) AND the workspace tier (`config.trivia`) SHALL each accept an optional `tellMeMore: { enabled: boolean }` field. The value participates in the `tellMeMore` cascade resolved at reveal time (cascade order: `game → workspace → default({ enabled: false })`) — there is no season or slot tier, mirroring the `allTimeRow` pattern. It governs whether the "Tell me more" button is rendered on the revealed card, per `trivia-tell-me-more`.

The field SHALL be parsed with the following rules:

- Absence is valid — the cascade falls through to workspace config and ultimately to the disabled default.
- A value that is not an object with a boolean `enabled` SHALL be rejected with a logged warning naming the tier (and game, at the game tier) and the violating value; the field SHALL then be treated as absent.
- The value SHALL be exposed on the parsed `TriviaGame` / `TriviaConfig` shapes so the resolver can read it.

The `upsert_game` and `set_workspace_config` MCP tools SHALL accept `tellMeMore` as an optional argument, persisting it on the game entry / workspace config respectively. Consistent with other optional fields, an explicit `null` SHALL clear a previously-set value, and omission SHALL preserve the existing value.

The `list_games` tool SHALL surface `tellMeMore` per-game when set (omitted from the entry when absent — no default injection at read time) and SHALL surface `workspaceDefaults.tellMeMore` IF AND ONLY IF `config.trivia.tellMeMore` is set in the loaded config.

#### Scenario: Absent field cascades to workspace then default

- **GIVEN** `config.trivia.games[]` has `{ name: "main", ... }` (no `tellMeMore`)
- **AND** `config.trivia` has no `tellMeMore`
- **WHEN** the reveal flow resolves the cascade for `main`
- **THEN** the resolved value is `{ enabled: false }` (the built-in default)

#### Scenario: Game-level value beats workspace

- **GIVEN** `config.trivia.games[]` has `{ name: "main", tellMeMore: { enabled: false }, ... }`
- **AND** `config.trivia.tellMeMore: { enabled: true }`
- **WHEN** the reveal flow resolves the cascade for `main`
- **THEN** the resolved value is `{ enabled: false }`

#### Scenario: Invalid value is rejected

- **GIVEN** `config.trivia.games[]` has `{ name: "main", tellMeMore: "yes", ... }`
- **WHEN** the config is parsed
- **THEN** a warning is logged identifying the game and the invalid value
- **AND** the parsed game has no `tellMeMore` field (treated as absent)

#### Scenario: upsert_game persists tellMeMore

- **WHEN** `upsert_game({ name: "main", tellMeMore: { enabled: true } })` is called
- **THEN** the game entry is persisted with `tellMeMore: { enabled: true }`

#### Scenario: set_workspace_config persists tellMeMore

- **WHEN** `set_workspace_config({ tellMeMore: { enabled: true } })` is called
- **THEN** `config.trivia.tellMeMore` is persisted as `{ enabled: true }`

#### Scenario: Explicit null clears the field

- **WHEN** `upsert_game({ name: "main", tellMeMore: null })` is called on a game that had `tellMeMore` set
- **THEN** the game entry no longer carries a `tellMeMore` field

#### Scenario: list_games surfaces the field when set

- **GIVEN** a game with `tellMeMore: { enabled: true }` and `config.trivia.tellMeMore: { enabled: false }`
- **WHEN** `list_games` runs
- **THEN** the per-game entry includes `tellMeMore: { enabled: true }`
- **AND** `workspaceDefaults.tellMeMore` is `{ enabled: false }`

#### Scenario: list_games omits the field when absent

- **GIVEN** a game without an explicit `tellMeMore` and `config.trivia` without `tellMeMore`
- **WHEN** `list_games` runs
- **THEN** the per-game entry does NOT include a `tellMeMore` field
- **AND** `workspaceDefaults.tellMeMore` is absent
