## ADDED Requirements

### Requirement: finalRevealSummary field on TriviaGame and workspace

`TriviaGame` (entries in `config.trivia.games[]`) AND the workspace tier (`config.trivia`) SHALL each accept an optional `finalRevealSummary: "yes" | "no" | "in-thread"` field. The value participates in the `finalRevealSummary` cascade resolved at reveal time (cascade order: `game → workspace → default("yes")`) — there is no season or slot tier, mirroring the `allTimeRow` pattern. It governs the standalone reveal-summary narrative's presence and placement, per `trivia-final-reveal-summary`.

The parser SHALL reject any value other than the three literals with a field-scoped validation error and drop the offending value while preserving the rest of the entry. The `upsert_game` and `set_workspace_config` MCP tools SHALL accept `finalRevealSummary` as an optional argument (one of the three literals), persisting it; an explicit `null` SHALL clear a previously-set value and omission SHALL preserve it. The `list_games` tool SHALL surface `finalRevealSummary` per-game when set (omitted when absent) and SHALL surface `workspaceDefaults.finalRevealSummary` IF AND ONLY IF `config.trivia.finalRevealSummary` is set.

#### Scenario: Absent at both tiers resolves to default

- **GIVEN** a game with no `finalRevealSummary` and `config.trivia` with none
- **WHEN** the reveal resolves the axis
- **THEN** it resolves to `"yes"`

#### Scenario: Game value wins over workspace

- **GIVEN** a game with `finalRevealSummary: "in-thread"` and `config.trivia.finalRevealSummary: "yes"`
- **WHEN** the reveal resolves the axis
- **THEN** it resolves to `"in-thread"`

#### Scenario: upsert_game persists and null clears

- **WHEN** `upsert_game({ name: "main", finalRevealSummary: "no" })` is called, then `upsert_game({ name: "main", finalRevealSummary: null })`
- **THEN** after the first call the entry has `finalRevealSummary: "no"`, and after the second the field is absent

#### Scenario: set_workspace_config persists the axis

- **WHEN** `set_workspace_config({ finalRevealSummary: "in-thread" })` is called
- **THEN** `config.trivia.finalRevealSummary` is persisted as `"in-thread"`

#### Scenario: list_games surfaces per-game and workspace values

- **GIVEN** a game with `finalRevealSummary: "in-thread"` and `config.trivia.finalRevealSummary: "yes"`
- **WHEN** `list_games` is called
- **THEN** the per-game entry includes `finalRevealSummary: "in-thread"` and `workspaceDefaults.finalRevealSummary` is `"yes"`

#### Scenario: list_games omits when unset

- **GIVEN** a game without the axis and `config.trivia` without it
- **WHEN** `list_games` is called
- **THEN** the per-game entry omits `finalRevealSummary` and `workspaceDefaults.finalRevealSummary` is absent
