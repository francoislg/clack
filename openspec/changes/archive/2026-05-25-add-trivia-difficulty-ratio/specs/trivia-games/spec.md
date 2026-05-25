## ADDED Requirements

### Requirement: difficultyRatio axis at workspace and per-game tiers

The Trivia plugin's runtime configuration SHALL accept an optional `difficultyRatio` axis at the workspace tier (`config.trivia.difficultyRatio`) and the per-game tier (`config.trivia.games[i].difficultyRatio`). The axis is per-format:

```
TriviaDifficultyRatioConfig = Partial<Record<
  "boolean" | "choice" | "freeform",
  Record<"easy" | "medium" | "hard", number>
>>
```

Each per-format bucket weight map (the inner `{ easy, medium, hard }`) SHALL be validated as non-negative integers with at least one strictly positive entry. Unknown keys SHALL be rejected at config-load time. Missing keys SHALL be tolerated and normalized to weight `0` (matching the existing weighted-axis validator pattern used by `answersFormat` / `questionType` / `freeformAnswerShape`) — admins can write `{ easy: 1, medium: 1 }` to mean "never roll Hard" without having to write `hard: 0` explicitly. An empty inner map (`{}`) and an all-zeros inner map SHALL still be rejected because neither has a strictly positive entry.

Resolution SHALL follow the standard four-tier cascade — slot → season → game → workspace → built-in default — with **whole-object replace per tier**: the first tier that supplies a complete `{ easy, medium, hard }` weight map for the queried format wins; lower tiers do NOT contribute partial values into the resolved triple.

The built-in default SHALL be per-format: `boolean` and `choice` default to `{ easy: 3, medium: 6, hard: 1 }` (preserving the prior effective 30%/60%/10% distribution); `freeform` defaults to `{ easy: 5, medium: 4, hard: 1 }` to skew easier in tandem with the already-easier `DEFAULT_DIFFICULTY_RANGES.freeform` band.

The `list_games` tool SHALL surface `workspaceDefaults.difficultyRatio` IF AND ONLY IF `config.trivia.difficultyRatio` is set in the loaded config (absent fields signal the workspace relies on the cascade default).

#### Scenario: Workspace difficultyRatio surfaces via list_games

- **GIVEN** `config.trivia.difficultyRatio` is `{ boolean: { easy: 1, medium: 1, hard: 1 }, freeform: { easy: 5, medium: 4, hard: 1 } }` (and `choice` is absent)
- **WHEN** `list_games` is called
- **THEN** `workspaceDefaults.difficultyRatio` matches the stored object exactly, including the absence of the `choice` key

#### Scenario: Workspace difficultyRatio absent when not configured

- **GIVEN** `config.trivia` has no `difficultyRatio` field set
- **WHEN** `list_games` is called
- **THEN** `workspaceDefaults.difficultyRatio` is absent from the response

#### Scenario: Inner weight map with all-zero weights rejected at load

- **GIVEN** a config file with `trivia.difficultyRatio.boolean = { easy: 0, medium: 0, hard: 0 }`
- **WHEN** the config is loaded
- **THEN** validation fails with a structured error indicating the inner map must have at least one strictly positive weight

#### Scenario: Inner weight map with unknown bucket key rejected at load

- **GIVEN** a config file with `trivia.difficultyRatio.choice = { easy: 1, hard: 1, impossible: 1 }`
- **WHEN** the config is loaded
- **THEN** validation fails with a structured error naming `impossible` as an unknown bucket (allowed: `easy`, `medium`, `hard`)

#### Scenario: Per-game difficultyRatio overrides workspace tier

- **GIVEN** `config.trivia.difficultyRatio.boolean` is `{ easy: 1, medium: 1, hard: 1 }`
- **AND** `config.trivia.games[0].name === "main"` and `config.trivia.games[0].difficultyRatio.boolean` is `{ easy: 0, medium: 1, hard: 0 }`
- **WHEN** `get_ideas(game: "main")` is invoked many times with `suggestedAnswersFormat` resolving to `"boolean"` and no season-tier override
- **THEN** every invocation produces `suggestedDifficulty = "Medium"`

## REMOVED Requirements

### Requirement: difficulty.minimumThreshold field at workspace and per-game tiers

**Reason:** The reject-below threshold is folded into the bucket's range under the new strict-membership difficulty gate (the rolled bucket's `[min, max]` IS the accept/reject bound).

**Migration:** None. `DifficultyRanges` no longer includes `minimumThreshold`; existing on-disk config carrying `difficulty.*.minimumThreshold` fails validation and must be hand-edited before deploy (single deployment, acknowledged in the proposal).
