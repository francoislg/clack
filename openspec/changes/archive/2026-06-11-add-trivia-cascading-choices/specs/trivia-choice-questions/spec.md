## MODIFIED Requirements

### Requirement: Choice-question configuration

The system SHALL accept an optional `trivia.answersFormat` configuration block — a map from answers-format name (`"boolean"` or `"choice"`) to a non-negative integer weight — and an optional `choices` configuration block with numeric `min` and `max` fields (both must satisfy `2 ≤ min ≤ max ≤ 4`; built-in default when absent at every tier is `DEFAULT_TRIVIA_CHOICES`). The `choices` block is a cascading axis settable at the slot, season, game, and workspace (`trivia.choices`) tiers, validated identically at every tier. When `trivia.answersFormat` is absent or contains only the `"boolean"` key, the system SHALL behave identically to pre-choice deployments (no choice questions are generated).

#### Scenario: Default configuration generates boolean questions only

- **GIVEN** `data/config.json` has no `trivia.answersFormat` field
- **WHEN** `get_ideas` is called
- **THEN** the returned `suggestedAnswersFormat` is always `"boolean"`

#### Scenario: Mixed-format configuration generates both formats

- **GIVEN** `data/config.json` has `trivia.answersFormat: { "boolean": 2, "choice": 1 }`
- **WHEN** `get_ideas` is called many times
- **THEN** approximately 2/3 of calls return `suggestedAnswersFormat: "boolean"` and approximately 1/3 return `suggestedAnswersFormat: "choice"` (within statistical tolerance)

#### Scenario: Choice-only configuration

- **GIVEN** `data/config.json` has `trivia.answersFormat: { "choice": 1 }`
- **WHEN** `get_ideas` is called
- **THEN** the returned `suggestedAnswersFormat` is always `"choice"`

#### Scenario: Invalid choice bounds rejected at load

- **GIVEN** `data/config.json` has `trivia.choices: { min: 5, max: 10 }`
- **WHEN** the config is loaded
- **THEN** the system rejects the config with a validation error indicating bounds must satisfy `2 ≤ min ≤ max ≤ 4`

#### Scenario: Invalid choice bounds rejected at any tier

- **GIVEN** a game carries `choices: { min: 1, max: 4 }`
- **WHEN** the config is loaded (or `upsert_game` is called with those bounds)
- **THEN** the system rejects it with the same `2 ≤ min ≤ max ≤ 4` validation error used at the workspace tier

### Requirement: answersFormat is per-season, with config fallback

`questionsTypes` resolution at `get_ideas` time SHALL follow this priority:

1. If the seasons feature is enabled AND `findCurrentSeason(state, Date.now())` returns a non-null `SeasonEntry` whose `format` is present AND the resolved slot (per the call's `slot` argument, default `0`) has a `questionTypes` field set, use that slot's `questionTypes`.
2. Otherwise, if the seasons feature is enabled AND `findCurrentSeason` returns a non-null `SeasonEntry` whose `questionTypes` field is set, use that entry's `questionTypes`.
3. Otherwise (seasons disabled, `now` falls in a timeline gap, the current entry has no `format` or the slot has no `questionTypes`, AND the current entry has no top-level `questionTypes` field), use `config.trivia.questionsTypes`.
4. Otherwise (all sources absent), default to `{ "boolean": 1 }` (pure-boolean, equivalent to pre-change behavior).

The system SHALL re-read these sources on every `get_ideas` call — no caching, no pre-computation. The `choices.{min, max}` setting SHALL resolve through the full cascade (`slot → season → game → workspace → built-in default`) like every other cascade axis — see the dedicated "Choice option-count bounds cascade through all tiers" requirement.

#### Scenario: Slot's questionTypes overrides season's

- **GIVEN** seasons are enabled and the active season has `questionTypes: { boolean: 1, choice: 1 }` and `format: { questions: [{ questionTypes: { choice: 1 } }, {}] }`
- **WHEN** `get_ideas` is called with `slot: 0`
- **THEN** the resolved `questionTypes` is `{ choice: 1 }` (slot 0 overrides)
- **AND** `suggestedType` is always `"choice"`

#### Scenario: Slot without questionTypes falls back to season's

- **GIVEN** seasons are enabled and the active season has `questionTypes: { boolean: 2, choice: 1 }` and `format: { questions: [{}, {}] }`
- **WHEN** `get_ideas` is called with `slot: 1`
- **THEN** the resolved `questionTypes` is the season's `{ boolean: 2, choice: 1 }`

#### Scenario: Current season's questionTypes overrides config (no format)

- **GIVEN** seasons are enabled and `findCurrentSeason(state, now)` returns an entry with `questionTypes: { "choice": 1 }` and no `format`
- **AND** `config.trivia.questionsTypes` is `{ "boolean": 1 }`
- **WHEN** `get_ideas` is called
- **THEN** the returned `suggestedType` is always `"choice"`

#### Scenario: Current season without questionTypes or format falls back to config

- **GIVEN** seasons are enabled and the current `SeasonEntry` has no `questionTypes` field and no `format` field
- **AND** `config.trivia.questionsTypes` is `{ "boolean": 2, "choice": 1 }`
- **WHEN** `get_ideas` is called
- **THEN** the system uses `config.trivia.questionsTypes` weights for the random roll

#### Scenario: Timeline gap falls back to config

- **GIVEN** seasons are enabled but `findCurrentSeason(state, now)` returns `null` (now falls between seasons)
- **AND** `config.trivia.questionsTypes` is `{ "boolean": 2, "choice": 1 }`
- **WHEN** `get_ideas` is called
- **THEN** the system uses `config.trivia.questionsTypes` weights

#### Scenario: Seasons disabled uses config

- **GIVEN** seasons are disabled (`trivia.seasons.enabled: false` or absent)
- **AND** `config.trivia.questionsTypes` is `{ "boolean": 2, "choice": 1 }`
- **WHEN** `get_ideas` is called
- **THEN** the system uses `config.trivia.questionsTypes` weights for the random roll

#### Scenario: All sources absent defaults to boolean-only

- **GIVEN** seasons are enabled with no current entry questionTypes, no format, AND `config.trivia.questionsTypes` is absent
- **WHEN** `get_ideas` is called
- **THEN** the returned `suggestedType` is always `"boolean"`

#### Scenario: Mid-season format update via upsert_season takes effect on next call

- **GIVEN** `get_ideas(slot: 0)` was called once with no format
- **WHEN** `upsert_season(currentSlug, { format: { questions: [{ questionTypes: { choice: 1 } }] } })` is called and `get_ideas(slot: 0)` is called again
- **THEN** the second call uses the new slot 0's `questionTypes` of `{ choice: 1 }`

#### Scenario: Mid-season update via upsert_season takes effect on next call

- **GIVEN** `get_ideas` was called once with the current entry's previous `questionTypes`
- **WHEN** `upsert_season(currentSlug, { questionTypes: { "choice": 1 } })` is called and `get_ideas` is called again
- **THEN** the second call uses the updated weights

### Requirement: Server-rolled choice metadata in get_ideas

When `suggestedAnswersFormat` resolves to `"choice"`, `get_ideas` SHALL additionally return:

- `suggestedChoiceCount`: a uniform random integer in `[min, max]`, where `min` and `max` are the cascade-resolved choice bounds for the call's coordinate (`resolveCascade("choices", cascadeCtx)`: slot → season → game → workspace → built-in default).
- `suggestedCorrectIndex`: a uniform random integer in `[0, suggestedChoiceCount)`.

When `suggestedAnswersFormat` resolves to `"boolean"`, the boolean-path `suggestedAnswer` SHALL continue to be returned as before, and `suggestedChoiceCount` and `suggestedCorrectIndex` SHALL NOT be returned.

#### Scenario: Choice path returns rolled count and index

- **WHEN** `get_ideas` is called and `suggestedAnswersFormat` is `"choice"`
- **THEN** the response contains both `suggestedChoiceCount` (integer in the resolved `[min, max]`) and `suggestedCorrectIndex` (integer in `[0, suggestedChoiceCount)`)
- **AND** the response does NOT contain `suggestedAnswer`

#### Scenario: Boolean path omits choice fields

- **WHEN** `get_ideas` is called and `suggestedAnswersFormat` is `"boolean"`
- **THEN** the response contains `suggestedAnswer` (boolean)
- **AND** the response does NOT contain `suggestedChoiceCount` or `suggestedCorrectIndex`

#### Scenario: correctIndex distribution is uniform across runs

- **GIVEN** the resolved bounds are `min = 4` and `max = 4` (always 4 choices)
- **WHEN** `get_ideas` is called 1000 times with `suggestedAnswersFormat: "choice"`
- **THEN** the distribution of `suggestedCorrectIndex` across `{0, 1, 2, 3}` is uniform within statistical tolerance

### Requirement: save_question accepts choice-question shape

The `save_question` MCP tool SHALL accept the discriminated arguments for choice questions: `answersFormat: "choice"`, `choices: string[]` (length within the cascade-resolved `[min, max]` bounds for the question's coordinate), and `correctIndex: number` (an integer in `[0, choices.length)`). The tool SHALL validate:

- `answersFormat` MUST be `"choice"` for the choice path (and `"boolean"` for the boolean path; the field is now required on writes).
- `choices.length` MUST be ≥ resolved `min` and ≤ resolved `max`, where `min`/`max` come from `resolveCascade("choices", …)` evaluated at the saved question's slot/season/game/workspace coordinate (handed to the choice handler as a pre-resolved value, mirroring `resolvedJudgeLeniency`).
- `correctIndex` MUST be an integer in `[0, choices.length)`.
- `new Set(choices.map(c => c.trim().toLowerCase())).size === choices.length` — no duplicate or whitespace-equivalent choice strings.
- Each choice string MUST be 1–100 characters after trimming.
- The boolean-path arguments (`isTrue`) MUST NOT be set when `answersFormat: "choice"`.

On validation failure, the tool SHALL return a structured error indicating which constraint failed.

#### Scenario: Valid choice question saved

- **WHEN** `save_question` is called with `answersFormat: "choice"`, `choices: ["Mercury", "Venus", "Earth", "Mars"]`, `correctIndex: 0`, and a valid category/statement/emojis
- **THEN** the question is stored in `questions.json` with all six fields plus generated `id` and `createdAt`

#### Scenario: correctIndex out of range rejected

- **WHEN** `save_question` is called with `choices` of length 4 and `correctIndex: 4`
- **THEN** the tool returns a validation error indicating `correctIndex` must be in `[0, choices.length)`

#### Scenario: Duplicate choice strings rejected

- **WHEN** `save_question` is called with `choices: ["Paris", "London", "Paris", "Rome"]`
- **THEN** the tool returns a validation error indicating choices must be unique

#### Scenario: Whitespace-equivalent duplicate choices rejected

- **WHEN** `save_question` is called with `choices: ["Paris", "  PARIS  ", "London", "Rome"]`
- **THEN** the tool returns a validation error indicating choices must be unique (after trimming and case-folding)

#### Scenario: Choices out of resolved bounds rejected

- **GIVEN** the question's coordinate resolves to bounds `min: 2`, `max: 3`
- **WHEN** `save_question` is called with `choices` of length 4
- **THEN** the tool returns a validation error indicating choices length is outside the resolved `[min, max]`

#### Scenario: Choice question with isTrue rejected

- **WHEN** `save_question` is called with `answersFormat: "choice"`, valid `choices`/`correctIndex`, AND `isTrue: true`
- **THEN** the tool returns a validation error indicating `isTrue` is invalid for choice questions

## ADDED Requirements

### Requirement: Choice option-count bounds cascade through all tiers

The `choices: { min, max }` option-count bounds SHALL be a first-wins cascade axis resolved through `resolveCascade("choices", ctx)`, following the standard order `slot → season → game → workspace → built-in default` with whole-object replace per tier (no field-level merge across tiers). The built-in default is `DEFAULT_TRIVIA_CHOICES` (`{ min: 4, max: 4 }`). Both consumers — the `get_ideas` choice-count roll and the `save_question` length validation — SHALL resolve bounds through this single path for the same coordinate, so a count the roll produces always passes save validation. The bounds SHALL NOT be stamped on the `TriviaQuestion` record (the stored `choices` array already encodes the resolved count).

#### Scenario: Game override wins over workspace

- **GIVEN** `config.trivia.choices` is `{ min: 4, max: 4 }` and a game carries `choices: { min: 2, max: 2 }`
- **WHEN** `get_ideas` rolls a choice question for that game (no season active, no slot override)
- **THEN** `suggestedChoiceCount` is `2`

#### Scenario: Per-slot pacing via game format

- **GIVEN** a game's `format.questions` is `[{ choices: { min: 2, max: 2 } }, { choices: { min: 4, max: 4 } }]` and no active season
- **WHEN** `get_ideas` rolls a choice question for `slot: 0`, then for `slot: 1`
- **THEN** slot 0 yields `suggestedChoiceCount: 2` and slot 1 yields `suggestedChoiceCount: 4`

#### Scenario: Season override wins over game

- **GIVEN** seasons are enabled, the active season carries `choices: { min: 3, max: 3 }`, and the game carries `choices: { min: 2, max: 2 }`
- **WHEN** `get_ideas` rolls a choice question (no per-slot override)
- **THEN** `suggestedChoiceCount` is `3`

#### Scenario: Absent at every tier falls back to default

- **GIVEN** no `choices` value is set at the slot, season, game, or workspace tier
- **WHEN** `get_ideas` rolls a choice question
- **THEN** the bounds are `DEFAULT_TRIVIA_CHOICES` (`{ min: 4, max: 4 }`) and `suggestedChoiceCount` is `4`

#### Scenario: Roll and save agree on bounds

- **GIVEN** a coordinate resolves to bounds `{ min: 2, max: 2 }`
- **WHEN** `get_ideas` rolls `suggestedChoiceCount: 2` for that coordinate and `save_question` is called with `choices` of length 2 for the same coordinate
- **THEN** `save_question` accepts the question (no bounds error), because both used `resolveCascade("choices", …)`

#### Scenario: explain_cascade reports the choices ladder

- **WHEN** a `member`+ user calls `explain_cascade({ game: "x", slot: 0 })`
- **THEN** the `choices` axis appears in the result with its resolved `value`, winning `tier`, and per-tier `ladder`
