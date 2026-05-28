## ADDED Requirements

### Requirement: Hint axis at workspace and per-game tiers

The Trivia plugin's runtime configuration SHALL accept an optional `hint` axis at the workspace tier (`config.trivia.hint`) and the per-game tier (`config.trivia.games[i].hint`). The axis shape, parser validation, cascade semantics, and runtime behavior are defined in the `trivia-question-hints` capability; this requirement records its placement in the per-game / workspace cascade tiers and its surfacing through `list_games`.

The `list_games` tool SHALL surface `workspaceDefaults.hint` IF AND ONLY IF `config.trivia.hint` is set in the loaded config, mirroring the additive pattern already used for `difficultyRatio`, `format`, `categories`, and `theme`. Each per-game entry's response SHALL include `hint` IF AND ONLY IF the corresponding `config.trivia.games[i].hint` is set.

Resolution at runtime SHALL follow the standard four-tier cascade — `slot → season → game → workspace → built-in default` — with whole-object replace per tier. When no tier sets `hint`, the resolved value SHALL be `{ mode: "none" }` (no hint generated, no hint UI rendered).

#### Scenario: Workspace hint surfaces via list_games

- **GIVEN** `config.trivia.hint` is `{ mode: "button", minDifficulty: "medium" }`
- **WHEN** `list_games` is called
- **THEN** `workspaceDefaults.hint` matches the stored object exactly

#### Scenario: Workspace hint absent when not configured

- **GIVEN** `config.trivia` has no `hint` field set
- **WHEN** `list_games` is called
- **THEN** `workspaceDefaults.hint` is absent from the response

#### Scenario: Per-game hint surfaces via list_games

- **GIVEN** `config.trivia.games[0].name === "main"` and `config.trivia.games[0].hint === { mode: "inline" }`
- **WHEN** `list_games` is called
- **THEN** the entry for `"main"` includes `hint: { mode: "inline" }` exactly as stored

#### Scenario: Per-game hint overrides workspace tier

- **GIVEN** `config.trivia.hint` is `{ mode: "button" }`
- **AND** `config.trivia.games[0].name === "main"` and `config.trivia.games[0].hint` is `{ mode: "none" }`
- **WHEN** `get_ideas(game: "main")` is invoked with no season-tier hint override
- **THEN** the payload's `suggestedHintMode` is `"none"` (game tier overrode workspace tier — whole-object replace, not field-level merge)

#### Scenario: Per-game hint absent — workspace cascade wins

- **GIVEN** `config.trivia.hint` is `{ mode: "inline", minDifficulty: "hard" }`
- **AND** `config.trivia.games[0].hint` is absent
- **AND** no season is active
- **WHEN** `get_ideas(game: "main")` is invoked and rolls `suggestedDifficulty: "Hard"`
- **THEN** the payload's `suggestedHintMode` is `"inline"`
