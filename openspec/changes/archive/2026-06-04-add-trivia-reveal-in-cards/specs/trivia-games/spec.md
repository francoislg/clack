## ADDED Requirements

### Requirement: includeRevealInQuestions field on TriviaGame and workspace

`TriviaGame` (entries in `config.trivia.games[]`) AND the workspace tier (`config.trivia`) SHALL each accept an optional `includeRevealInQuestions: "yes" | "no"` field. The value participates in the `includeRevealInQuestions` cascade resolved at reveal time (cascade order: `game → workspace → default("no")`) — there is no season or slot tier, mirroring the `allTimeRow` pattern. It governs whether each revealed question's card carries the reveal narrative, per `trivia-reveal-in-cards`.

The parser SHALL reject any value other than the two literals with a field-scoped validation error and drop the offending value while preserving the rest of the entry. The `upsert_game` and `set_workspace_config` MCP tools SHALL accept `includeRevealInQuestions` as an optional argument (one of the two literals), persisting it on the game entry / workspace config; an explicit `null` SHALL clear a previously-set value and omission SHALL preserve it. The `list_games` tool SHALL surface `includeRevealInQuestions` per-game when set (omitted when absent) and SHALL surface `workspaceDefaults.includeRevealInQuestions` IF AND ONLY IF `config.trivia.includeRevealInQuestions` is set.

#### Scenario: Absent at both tiers resolves to default

- **GIVEN** a game with no `includeRevealInQuestions` and `config.trivia` with none
- **WHEN** the reveal resolves the axis
- **THEN** it resolves to `"no"`

#### Scenario: Game value wins over workspace

- **GIVEN** a game with `includeRevealInQuestions: "yes"` and `config.trivia.includeRevealInQuestions: "no"`
- **WHEN** the reveal resolves the axis
- **THEN** it resolves to `"yes"`

#### Scenario: upsert_game persists and null clears

- **WHEN** `upsert_game({ name: "main", includeRevealInQuestions: "yes" })` is called, then `upsert_game({ name: "main", includeRevealInQuestions: null })`
- **THEN** after the first call the entry has `includeRevealInQuestions: "yes"`, and after the second the field is absent

#### Scenario: set_workspace_config persists the axis

- **WHEN** `set_workspace_config({ includeRevealInQuestions: "yes" })` is called
- **THEN** `config.trivia.includeRevealInQuestions` is persisted as `"yes"`

#### Scenario: list_games surfaces per-game and workspace values

- **GIVEN** a game with `includeRevealInQuestions: "yes"` and `config.trivia.includeRevealInQuestions: "no"`
- **WHEN** `list_games` is called
- **THEN** the per-game entry includes `includeRevealInQuestions: "yes"` and `workspaceDefaults.includeRevealInQuestions` is `"no"`

#### Scenario: list_games omits when unset

- **GIVEN** a game without the axis and `config.trivia` without it
- **WHEN** `list_games` is called
- **THEN** the per-game entry omits `includeRevealInQuestions` and `workspaceDefaults.includeRevealInQuestions` is absent
