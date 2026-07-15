# trivia-question-points Specification

## Purpose
TBD - created by archiving change add-trivia-variable-points. Update Purpose after archive.
## Requirements
### Requirement: Cascading points axis

The trivia cascade SHALL gain a `points` axis — a uniform first-wins `CascadeAxes` member with value shape `{ max: number; guidance?: string }`, cascading `seasonSlot → season → gameSlot → game → workspace → { max: 1 }` with whole-object replace per tier. The axis SHALL be registered in `AXIS_REGISTRY` (via the first-wins helper) and `AXIS_KEYS`, and SHALL have a per-axis validator plus a standalone zod schema export (the flat-axis pattern, alongside `triviaChoicesZod` / `triviaJudgeLeniencyZod`). It SHALL NOT be added to `TriviaAxisBag` nor to the `axisFieldsZod` map — both hold weighted-roll bag axes only.

The validator SHALL enforce: `max` is a required integer with `1 <= max <= 10`; `guidance`, when present, is a non-empty trimmed string of at most 500 characters.

#### Scenario: First-defined tier wins

- **GIVEN** a game with `points: { max: 3 }` and a workspace with `points: { max: 2, guidance: "hard = 2" }`
- **WHEN** `resolveCascade("points", ctx)` runs for that game
- **THEN** the resolved value is `{ max: 3 }` with winning tier `game` — the workspace `guidance` does NOT leak through (whole-object replace)

#### Scenario: Absent at every tier resolves to the 1-point default

- **WHEN** no tier sets `points`
- **THEN** `resolveCascade("points", ctx)` returns `{ max: 1 }` with tier `default`

#### Scenario: Validator rejects malformed values

- **WHEN** a tier value of `{ max: 0 }`, `{ max: 11 }`, `{ max: 2.5 }`, `{ guidance: "x" }` (missing `max`), or `{ max: 2, guidance: "" }` is validated
- **THEN** validation fails with a specific, actionable error naming the field

#### Scenario: Registry parity holds

- **WHEN** the cascade parity tests run
- **THEN** the config parser accepts `points` at every tier and `explain_cascade` reports the same resolution as generation-time consumers

### Requirement: get_ideas surfaces the axis only when guidance turns it on

`get_ideas` SHALL resolve `points` through `resolveCascade("points", ctx)` per slot. The per-slot payload SHALL include `maxPoints: number` and `pointsGuidance: string` if and only if the resolved value has BOTH `max > 1` AND a `guidance` string. In every other case (`max === 1`, or `max > 1` with no `guidance`) NEITHER field SHALL be present.

A cap alone is a PERMISSION, not an instruction: `{ max: 3 }` without guidance grants an admin room to reclass a question up to 3 via `override_question`, while Claude never sees the axis, never picks a value, and every question stays worth 1 — identical to legacy behavior and costing no prompt budget.

#### Scenario: Cap plus guidance surfaces both fields

- **GIVEN** workspace `points: { max: 3, guidance: "difficulty drives points" }`
- **WHEN** `get_ideas` runs
- **THEN** the payload includes `maxPoints: 3` and `pointsGuidance: "difficulty drives points"`

#### Scenario: Cap without guidance surfaces nothing

- **GIVEN** workspace `points: { max: 3 }` with no `guidance`
- **WHEN** `get_ideas` runs
- **THEN** the payload contains neither `maxPoints` nor `pointsGuidance`
- **AND** the axis remains available to `override_question` for admin reclassing

#### Scenario: Guidance without a cap above 1 surfaces nothing

- **GIVEN** workspace `points: { max: 1, guidance: "hard = 2" }`
- **WHEN** `get_ideas` runs
- **THEN** the payload contains neither field (the cap forbids anything above 1, so the guidance is unreachable)

#### Scenario: Legacy deployments see nothing

- **GIVEN** no tier sets `points`
- **WHEN** `get_ideas` runs
- **THEN** the payload contains neither `maxPoints` nor `pointsGuidance`

### Requirement: Generation prompt instructs a guidance-driven points pick

The shared per-slot generation instructions SHALL include a POINTS step, active only when the `get_ideas` payload carries `maxPoints`: Claude picks an integer in `[1, maxPoints]` honoring `pointsGuidance`, defaulting to 1 when the guidance does not call for more, and passes the pick to `save_question` as `points`. When `maxPoints` is absent, the step SHALL instruct omitting `points` entirely.

#### Scenario: Prompt gates the step on maxPoints

- **WHEN** the question-generation prompt is built
- **THEN** its POINTS directive instructs picking `1..maxPoints` only when `maxPoints` is present, and omitting `points` otherwise
- **AND** it directs a pick of 1 when the guidance does not call for a higher value

### Requirement: save_question validates and stamps points

`save_question` SHALL accept an optional integer `points` argument, re-resolve the `points` cascade for the question's slot (the same server-side re-resolution pattern as `resolvedChoiceBounds`), and:

- REJECT a non-integer or out-of-range value (`points < 1` or `points > resolvedMax`) with an actionable error.
- REJECT a supplied `points` when the resolved `max` is 1 (the axis is not in play — mirrors `choiceEmojis` under `"numbers"`).
- STAMP `points` on the question record only when the accepted value is greater than 1. A saved value of 1 SHALL NOT be written; absence on a record SHALL read as 1 everywhere.

#### Scenario: Valid pick is stamped

- **GIVEN** resolved `points: { max: 3 }` and `save_question` called with `points: 2`
- **THEN** the persisted record carries `points: 2`

#### Scenario: Out-of-range pick is rejected

- **GIVEN** resolved `points: { max: 3 }`
- **WHEN** `save_question` is called with `points: 4` (or `points: 0`, or `points: 1.5`)
- **THEN** the save fails with an error naming the valid range

#### Scenario: Points supplied while the axis is inactive is rejected

- **GIVEN** resolved `points: { max: 1 }`
- **WHEN** `save_question` is called with any `points` value
- **THEN** the save fails with an error explaining the axis is not enabled for this slot

#### Scenario: One-point value is normalized to absence

- **GIVEN** resolved `points: { max: 3 }`
- **WHEN** `save_question` is called with `points: 1`
- **THEN** the save succeeds and the persisted record has NO `points` field

### Requirement: Worth-N-points card block

`post_questions` SHALL append a deterministic `context` block reading "⭐ Worth N points" (localized via the plugin i18n dictionary, en + fr) immediately BEFORE the question's answer-buttons (actions) block, if and only if the record's stamped `points > 1`. The block SHALL be built from the question record (never from Claude-authored blocks) and SHALL be part of the stamped `postedBlocks`, so live-roster rebuilds and reveal-time repaints preserve it.

#### Scenario: Two-point question shows the line

- **GIVEN** a question record with `points: 2`
- **WHEN** `post_questions` posts it
- **THEN** the posted card contains a context block with the localized "Worth 2 points" text (with the ⭐ Unicode char, never a `:star:` shortcode) directly above the answer buttons
- **AND** the block is present in the record's `postedBlocks`

#### Scenario: Block survives roster rebuild

- **GIVEN** a posted 2-point question
- **WHEN** a player answers and the live roster footer is rebuilt from `postedBlocks`
- **THEN** the worth-points block is still present on the card

#### Scenario: One-point question is unchanged

- **GIVEN** a question record with no `points` field
- **WHEN** `post_questions` posts it
- **THEN** the card layout is byte-for-byte identical to pre-feature behavior (no worth-points block)

### Requirement: Points-aware aggregation joins the question record

`computeLeaderboard` SHALL take a required `questionPoints` map (questionId → stamped points) and pay each correct row `questionPoints.get(questionId) ?? 1` into new `totalPoints` and (when a current season is set) `currentSeasonPoints` fields on `LeaderboardEntry`. Points SHALL NOT be denormalized onto `SubmittedAnswer` rows — verdict mutations (`override_answer`, `replay_question` re-derivation, invalidation, freeform judging) stay consistent through the join with zero extra bookkeeping.

`totalCorrect`, `totalAnswered`, and `accuracy` SHALL keep their exact current meanings. Ranking SHALL become points-primary: `sortBy: "totalCorrect"` sorts by `totalPoints` descending with `accuracy` tiebreak; `sortBy: "accuracy"` sorts by `accuracy` descending with `totalPoints` tiebreak. Pending freeform rows and cheater-filtered rows SHALL remain excluded exactly as today.

#### Scenario: A two-point correct answer pays two

- **GIVEN** alice correctly answered a question stamped `points: 2` and bob correctly answered two 1-point questions
- **WHEN** the leaderboard is computed
- **THEN** alice has `totalPoints: 2, totalCorrect: 1` and bob has `totalPoints: 2, totalCorrect: 2`

#### Scenario: Uniform one-point history is byte-for-byte legacy

- **GIVEN** an answer history where no question record carries `points`
- **WHEN** the leaderboard is computed
- **THEN** every entry's `totalPoints` equals its `totalCorrect`, `currentSeasonPoints` equals `currentSeasonCorrect`, and the ranking order is identical to pre-feature behavior

#### Scenario: Incorrect answers on high-value questions pay nothing

- **GIVEN** alice incorrectly answered a question stamped `points: 3`
- **WHEN** the leaderboard is computed
- **THEN** the row contributes 0 to `totalPoints` and 1 to `totalAnswered`

#### Scenario: Verdict flip repays through the join

- **GIVEN** alice's answer on a 2-point question is flipped correct via `override_answer`
- **WHEN** the leaderboard is recomputed
- **THEN** alice's `totalPoints` includes the 2 — no answer-row field needed updating

### Requirement: Points on scoring and audit read surfaces

The points dimension SHALL surface additively on read paths:

- `retrieve_scores` SHALL carry `totalPoints` / `currentSeasonPoints` on every leaderboard entry, computed by the same shared `computeLeaderboard` helper the reveal uses (so the two agree by construction).
- Season-MVP selection (`pickSeasonMvp`) SHALL pick by current-season points, ties broken as today.
- `find_previous_questions` SHALL surface the stamped `points` on records that carry it (it affects scoring, same inclusion rule as `difficulty`), and SHALL likewise surface any captured override originals. Both fields are self-gating — absent on the record means absent from the result — so an ordinary 1-point, never-overridden row is byte-for-byte unchanged.

How `compute_answers` carries points on its own `leaderboard` and reveal entries is owned by the `trivia-reveal-processor` capability and specified there — this capability defines the stamped value those surfaces read, not their payload shape.

#### Scenario: MVP follows points

- **GIVEN** a season where alice holds 5 points from 3 correct and bob holds 4 points from 4 correct
- **WHEN** season rollover picks the MVP
- **THEN** alice is selected

#### Scenario: Search surfaces the stamp

- **GIVEN** a saved question with `points: 3`
- **WHEN** `find_previous_questions` returns it
- **THEN** the result includes `points: 3`
- **AND** a sibling question with no stamped `points` carries no `points` field

#### Scenario: Search surfaces a reclassed question's originals

- **GIVEN** a question reclassed from 1 point to 2 via `override_question`
- **WHEN** `find_previous_questions` returns it
- **THEN** the result carries `points: 2` alongside the captured originals recording that it was posed worth 1
- **AND** a never-overridden question carries no originals field

### Requirement: points MCP Read/Write Surface

`upsert_game`, `upsert_season` (create and update branches, including its per-slot tier), and `set_workspace_config` SHALL accept `points` with omit-to-keep / null-to-clear semantics, validating through the shared per-axis validator before writing. `list_games` SHALL surface the axis on per-game `axisOverrides` and `workspaceDefaults` (registry-projected), and `explain_cascade` SHALL audit it like any other axis.

#### Scenario: Game-tier write round-trips

- **WHEN** `upsert_game` is called with `points: { max: 3, guidance: "finale is high-stakes" }`
- **THEN** the game persists the value and `list_games` surfaces it under that game's `axisOverrides`

#### Scenario: Null clears the tier

- **GIVEN** a game with a stored `points` value
- **WHEN** `upsert_game` is called with `points: null`
- **THEN** the field is removed and resolution falls through to the workspace tier

#### Scenario: Invalid write is rejected

- **WHEN** `set_workspace_config` is called with `points: { max: 15 }`
- **THEN** the tool returns the validator's error and writes nothing

