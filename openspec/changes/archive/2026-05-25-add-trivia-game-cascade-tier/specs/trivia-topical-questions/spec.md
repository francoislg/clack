## MODIFIED Requirements

### Requirement: questionType axis on question records and configuration

The system SHALL persist `questionType: "fact" | "topical"` on every newly-written `TriviaQuestion` record. When a stored record carries no `questionType` field, the system SHALL read it as `"fact"`. The system SHALL accept a `questionType` weight map of the same shape as `answersFormat` (a map from `"fact"`/`"topical"` to non-negative integer weights) at four cascade tiers: `config.trivia.questionType` (workspace), `TriviaGame.questionType` (per-game, NEW), `SeasonEntry.questionType` (per-season), and `SeasonFormatSlot.questionType` (per-slot). Resolution priority on each `get_ideas` call SHALL be:

1. Slot's `questionType` (when the active season has a `format` and the resolved slot has the field).
2. Season's `questionType` (when set on the current `SeasonEntry`).
3. Per-game `questionType` (when set on the `TriviaGame` entry for the call's `game` argument).
4. `config.trivia.questionType` (workspace).
5. Default `{ fact: 1, topical: 0 }` — equivalent to pre-change behavior.

The system SHALL re-read these sources on every `get_ideas` call (no caching). The system SHALL reject `questionType` maps (at any tier) whose weights are all-zero or contain keys other than `"fact"` and `"topical"`.

#### Scenario: Legacy record without questionType reads as fact

- **GIVEN** a stored `TriviaQuestion` record with `answersFormat: "boolean"` and no `questionType` field
- **WHEN** any code path reads the record
- **THEN** the system treats it as `questionType: "fact"`

#### Scenario: New record carries questionType

- **WHEN** `save_question` writes any new question
- **THEN** the stored record has a `questionType` of either `"fact"` or `"topical"`

#### Scenario: Default configuration generates fact-only questions

- **GIVEN** no `questionType` weights are set at any cascade tier
- **WHEN** `get_ideas` is called repeatedly
- **THEN** `suggestedQuestionType` is always `"fact"`

#### Scenario: Mixed configuration generates both types

- **GIVEN** `config.trivia.questionType` is `{ fact: 3, topical: 1 }` and no game/season/slot override
- **WHEN** `get_ideas` is called many times
- **THEN** approximately 3/4 of calls return `suggestedQuestionType: "fact"` and 1/4 return `"topical"` (within statistical tolerance)

#### Scenario: Slot questionType overrides season

- **GIVEN** the active season has `questionType: { fact: 1, topical: 1 }` and `format.questions[0].questionType: { topical: 1 }`
- **WHEN** `get_ideas` is called with `slot: 0`
- **THEN** `suggestedQuestionType` is always `"topical"`

#### Scenario: Season questionType overrides per-game

- **GIVEN** the active season has `questionType: { topical: 1 }`
- **AND** `config.trivia.games[0].questionType` is `{ fact: 1 }`
- **WHEN** `get_ideas(game: "main")` is called
- **THEN** `suggestedQuestionType` is always `"topical"` (season tier wins over per-game tier)

#### Scenario: Per-game questionType overrides workspace

- **GIVEN** no season/slot override
- **AND** `config.trivia.games[0].questionType` is `{ topical: 1 }`
- **AND** `config.trivia.questionType` is `{ fact: 1 }`
- **WHEN** `get_ideas(game: "main")` is called
- **THEN** `suggestedQuestionType` is always `"topical"` (per-game tier wins over workspace tier)

#### Scenario: Season questionType overrides config

- **GIVEN** the active season has `questionType: { topical: 1 }` and `config.trivia.questionType` is `{ fact: 1 }`
- **AND** no per-game override
- **WHEN** `get_ideas` is called
- **THEN** `suggestedQuestionType` is always `"topical"`

#### Scenario: All-zero weights rejected at every tier

- **GIVEN** a `questionType` field set to `{ fact: 0, topical: 0 }` at any tier (workspace, game, season, or slot)
- **WHEN** the value is parsed
- **THEN** the parser rejects it with a validation error indicating at least one positive weight is required

#### Scenario: Unknown keys rejected at every tier

- **GIVEN** a `questionType` field with `{ fact: 1, news: 1 }` at any tier
- **WHEN** the value is parsed
- **THEN** the parser rejects it with a validation error indicating only `fact` and `topical` are permitted keys
