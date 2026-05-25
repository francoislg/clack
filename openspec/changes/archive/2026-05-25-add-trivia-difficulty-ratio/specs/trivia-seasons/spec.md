## ADDED Requirements

### Requirement: difficultyRatio axis at season and slot tiers

A season's stored record (`SeasonEntry` in `seasons.json`) and a slot's stored record (`format.questions[i]`) SHALL each accept an optional `difficultyRatio?: TriviaDifficultyRatioConfig` field (per-format keyed map of `{ easy, medium, hard }` weights — same shape as `config.trivia.difficultyRatio` per the `trivia-games` capability).

The `upsert_season` MCP tool SHALL accept `difficultyRatio` as an optional argument with the same create / update / clear semantics as the other axis fields (`answersFormat`, `questionType`, `contexts`, `freeformAnswerShape`):

- On CREATE, when provided, stored verbatim after validation.
- On UPDATE, an object value replaces the entry's existing `difficultyRatio`; explicit `null` clears the field; omission preserves the existing value.
- Mid-season mutation is permitted.

Slots inside `format.questions` SHALL likewise accept `difficultyRatio` as an optional per-slot field on `upsert_season` calls. Slot-tier `difficultyRatio` SHALL win over season-tier when both are set.

The `list_seasons` tool's return shape SHALL include `difficultyRatio?: TriviaDifficultyRatioConfig` on each season entry AND on each slot inside `format.questions`. The field SHALL be present IF AND ONLY IF the corresponding stored record carries an explicit value.

Validation invariants (enforced by `upsert_season`):

- Each per-format inner weight map (the `{ easy, medium, hard }`) SHALL contain only non-negative integers and SHALL have at least one strictly positive entry.
- Unknown keys at either level (formats other than `boolean` / `choice` / `freeform`; buckets other than `easy` / `medium` / `hard`) SHALL be rejected with a structured error.

#### Scenario: Create a season with difficultyRatio

- **WHEN** `upsert_season` is called with `game: "main", slug: "june-2026", startedAt: <T>, expectedEndAt: <T+30d>, difficultyRatio: { boolean: { easy: 5, medium: 3, hard: 1 } }`
- **THEN** the response carries `hasDifficultyRatio: true`
- **AND** the new entry carries `difficultyRatio: { boolean: { easy: 5, medium: 3, hard: 1 } }` verbatim

#### Scenario: Update a season's difficultyRatio mid-season

- **GIVEN** the active "may-2026" season has `startedAt <= now` and `difficultyRatio: { boolean: { easy: 1, medium: 1, hard: 1 } }`
- **WHEN** `upsert_season(game: "main", slug: "may-2026", { difficultyRatio: { boolean: { easy: 0, medium: 1, hard: 0 } } })` is called
- **THEN** the response is `{ action: "updated", hasDifficultyRatio: true, ... }`
- **AND** the entry's `difficultyRatio` is now `{ boolean: { easy: 0, medium: 1, hard: 0 } }`

#### Scenario: Clear a season's difficultyRatio by passing null

- **GIVEN** the active "may-2026" season has `difficultyRatio` set
- **WHEN** `upsert_season(game: "main", slug: "may-2026", { difficultyRatio: null })` is called
- **THEN** the entry's `difficultyRatio` field is removed
- **AND** the response carries `hasDifficultyRatio: false`

#### Scenario: Slot-tier difficultyRatio inside format

- **WHEN** `upsert_season` is called with a `format` whose `questions[1].difficultyRatio.choice` is `{ easy: 0, medium: 0, hard: 1 }`
- **THEN** the stored slot carries that `difficultyRatio` verbatim
- **AND** `list_seasons` surfaces `format.questions[1].difficultyRatio` matching the stored value
- **AND** `format.questions[0]` has no `difficultyRatio` field

#### Scenario: All-zeros inner weight map rejected

- **WHEN** `upsert_season` is called with `difficultyRatio: { boolean: { easy: 0, medium: 0, hard: 0 } }`
- **THEN** the call returns a structured validation error indicating the inner map must have at least one strictly positive weight

#### Scenario: Unknown bucket key rejected

- **WHEN** `upsert_season` is called with `difficultyRatio: { boolean: { easy: 1, medium: 1, hard: 1, expert: 1 } }`
- **THEN** the call returns a structured validation error naming `expert` as an unknown bucket

#### Scenario: list_seasons omits difficultyRatio when unset

- **GIVEN** a season entry has no `difficultyRatio` field
- **WHEN** `list_seasons` is invoked
- **THEN** that entry has no `difficultyRatio` field in the response

## REMOVED Requirements

### Requirement: difficulty.minimumThreshold field at season and slot tiers

**Reason:** The reject-below threshold is folded into the bucket's range under the new strict-membership difficulty gate.

**Migration:** None. `upsert_season` no longer accepts `difficulty.*.minimumThreshold` in its `difficulty` argument; the field is dropped from `DifficultyRanges`. Existing stored season entries containing `minimumThreshold` will fail validation on next load and must be hand-edited (single deployment, acknowledged in the proposal).
