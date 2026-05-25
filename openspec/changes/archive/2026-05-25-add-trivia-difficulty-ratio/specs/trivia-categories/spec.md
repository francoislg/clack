## MODIFIED Requirements

### Requirement: get_ideas samples suggestedDifficulty from the cascading difficultyRatio axis

The `get_ideas` tool's `suggestedDifficulty` field SHALL be sampled by weighted-random pick from the resolved `difficultyRatio` axis for the rolled `suggestedAnswersFormat` (boolean / choice / freeform). Resolution SHALL follow the standard cascade (slot → season → game → workspace → built-in default), with whole-object replacement per tier (a tier either supplies a complete `{ easy, medium, hard }` weight map for the given format, or it falls through to the next tier).

The built-in default `difficultyRatio` SHALL be per-format:

- `boolean` and `choice`: `{ easy: 3, medium: 6, hard: 1 }`, preserving the prior effective 30%/60%/10% distribution when no admin override is present.
- `freeform`: `{ easy: 5, medium: 4, hard: 1 }`, skewed toward easier buckets. Freeform is intrinsically harder than boolean/choice (typing an answer vs. picking from a list), so its default bucket-roll distribution leans easier in tandem with the already-easier `DEFAULT_DIFFICULTY_RANGES.freeform` band.

The fixed-probability sampling rule (`30% Easy / 60% Medium / 10% Hard` regardless of configuration) SHALL be removed. The `get_ideas` response SHALL no longer carry a `minimumDifficultyThreshold` field.

The bucket-to-1–10 mapping (`easy: [min, max]`, `medium: [min, max]`, `hard: [min, max]`) SHALL be returned as `suggestedDifficultyRange` per the existing per-format `difficulty` cascade (`DifficultyRanges`); only the bucket-PICK distribution changes here, not the bucket-RANGES. The built-in default ranges remain `easy: [4, 6]`, `medium: [7, 8]`, `hard: [9, 10]` for boolean/choice (and softer for freeform), unchanged.

#### Scenario: suggestedDifficulty obeys configured ratio at workspace tier

- **GIVEN** `config.trivia.difficultyRatio.boolean` is `{ easy: 1, medium: 1, hard: 8 }`
- **AND** no season-tier, game-tier, or slot-tier `difficultyRatio` is set for boolean
- **WHEN** `get_ideas` is invoked many times with `suggestedAnswersFormat` resolving to `"boolean"`
- **THEN** each invocation independently produces `suggestedDifficulty = "Easy"` with probability 0.1, `"Medium"` with probability 0.1, and `"Hard"` with probability 0.8

#### Scenario: Slot-tier difficultyRatio overrides workspace-tier

- **GIVEN** `config.trivia.difficultyRatio.choice` is `{ easy: 0, medium: 1, hard: 0 }`
- **AND** the active season's `format.questions[0].difficultyRatio.choice` is `{ easy: 1, medium: 0, hard: 0 }`
- **WHEN** `get_ideas` is invoked with `slot: 0` and `suggestedAnswersFormat` resolves to `"choice"`
- **THEN** every invocation produces `suggestedDifficulty = "Easy"`

#### Scenario: Default ratio for boolean and choice when no tier configures difficultyRatio

- **GIVEN** no `difficultyRatio` is set at any cascade tier
- **WHEN** `get_ideas` is invoked many times with `suggestedAnswersFormat` resolving to `"boolean"` or `"choice"`
- **THEN** each invocation produces `suggestedDifficulty = "Easy"` with probability 0.3, `"Medium"` with probability 0.6, and `"Hard"` with probability 0.1 (matching the built-in default `{ easy: 3, medium: 6, hard: 1 }`)

#### Scenario: Default ratio for freeform skews easier

- **GIVEN** no `difficultyRatio` is set at any cascade tier
- **WHEN** `get_ideas` is invoked many times with `suggestedAnswersFormat` resolving to `"freeform"`
- **THEN** each invocation produces `suggestedDifficulty = "Easy"` with probability 5/10, `"Medium"` with probability 4/10, and `"Hard"` with probability 1/10 (matching the built-in default `{ easy: 5, medium: 4, hard: 1 }`)

#### Scenario: Response omits minimumDifficultyThreshold

- **WHEN** `get_ideas` is invoked
- **THEN** the returned object does NOT include a `minimumDifficultyThreshold` field

#### Scenario: suggestedDifficultyRange still surfaces the per-bucket range

- **GIVEN** the resolved `difficulty.boolean` is `{ easy: [3, 5], medium: [6, 7], hard: [8, 10] }` (no `minimumThreshold`)
- **AND** `get_ideas` rolls `suggestedDifficulty: "Hard"` with `suggestedAnswersFormat: "boolean"`
- **THEN** `suggestedDifficultyRange` is `[8, 10]`

## REMOVED Requirements

### Requirement: minimumDifficultyThreshold reject-below floor

**Reason:** Folded into the bucket's range. Under the new strict-membership gate, the rolled bucket's `[min, max]` IS the accept/reject bound — a separate threshold is redundant.

**Migration:** None. The `minimumThreshold` field is dropped from `DifficultyRanges` in code; existing on-disk config files that carry `difficulty.*.minimumThreshold` will fail validation and must be hand-edited before deploy (single deployment, acknowledged in the proposal).
