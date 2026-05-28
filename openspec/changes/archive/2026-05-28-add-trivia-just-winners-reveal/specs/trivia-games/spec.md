## ADDED Requirements

### Requirement: Per-game and workspace `revealResponses` accept `"just-winners"`

The per-game `revealResponses` field on `TriviaGame` and the workspace-level `config.trivia.revealResponses` field SHALL accept `"just-winners"` in addition to `"no"`, `"just-correctness"`, and `"yes"`. The `upsert_game` and `set_workspace_config` tools SHALL validate and persist the value, and `list_games` SHALL surface it (per-game and in workspace defaults) when set.

#### Scenario: upsert_game persists just-winners

- **WHEN** an admin calls `upsert_game` with `revealResponses: "just-winners"`
- **THEN** the value is validated and written to the game's config
- **AND** `list_games` reports `revealResponses: "just-winners"` for that game

#### Scenario: set_workspace_config persists just-winners default

- **WHEN** an admin calls `set_workspace_config` with `revealResponses: "just-winners"`
- **THEN** the workspace default is persisted as `"just-winners"`
