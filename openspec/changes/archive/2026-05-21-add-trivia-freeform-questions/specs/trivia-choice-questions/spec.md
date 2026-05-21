## ADDED Requirements

### Requirement: Freeform Answers Format Value

`TriviaQuestion.answersFormat` SHALL support `"freeform"` as a third valid value alongside `"boolean"` and `"choice"`. `config.trivia.answersFormat` weight maps and any per-season / per-slot cascade tier that overrides answers-format weights SHALL accept the `"freeform"` key with a non-negative integer weight. When a freeform weight is configured at any tier, `get_ideas` SHALL include `"freeform"` in its weighted-random roll for `suggestedAnswersFormat`.

The default workspace-level `config.trivia.answersFormat` SHALL remain `{ boolean: 1, choice: 0 }` (freeform off unless explicitly opted in by an admin).

#### Scenario: Freeform weight enabled at config tier

- **GIVEN** `config.trivia.answersFormat = { boolean: 1, choice: 1, freeform: 1 }`
- **WHEN** `get_ideas` rolls `suggestedAnswersFormat` 3000 times
- **THEN** approximately one-third of rolls return `"boolean"`, one-third return `"choice"`, and one-third return `"freeform"` (within statistical tolerance)

#### Scenario: Freeform weight zero at every tier

- **GIVEN** `config.trivia.answersFormat = { boolean: 1, choice: 1 }` (no freeform key) and no season / slot overrides freeform
- **WHEN** `get_ideas` rolls `suggestedAnswersFormat`
- **THEN** `"freeform"` is never returned
- **AND** behavior is identical to a deployment that has not enabled the feature

#### Scenario: Freeform weight set per slot

- **GIVEN** a `SeasonFormatSlot` with `answersFormat: { freeform: 1 }`
- **WHEN** `get_ideas` is called with that slot active
- **THEN** the slot cascade tier wins per existing cascade rules
- **AND** `suggestedAnswersFormat` is always `"freeform"` for questions generated against that slot

### Requirement: Freeform Question Record Discriminator

A `TriviaQuestion` record with `answersFormat: "freeform"` SHALL carry `expectedAnswer: string` and SHALL NOT carry `isTrue`, `choices`, or `correctIndex`. It MAY OPTIONALLY carry `acceptableAnswers?: string[]` and `gradingNotes?: string`. The discriminator validation in `save_question` SHALL reject cross-format combinations (e.g. `answersFormat: "freeform"` with `isTrue` supplied).

#### Scenario: Freeform record fields valid

- **WHEN** `save_question` is called with `answersFormat: "freeform"`, `expectedAnswer: "Paris"`, and optional `acceptableAnswers: ["Paris, France"]`
- **THEN** the question record is written with those fields
- **AND** does not carry `isTrue`, `choices`, or `correctIndex`

#### Scenario: Cross-format field rejected on freeform

- **WHEN** `save_question` is called with `answersFormat: "freeform"` and `isTrue: true` supplied
- **THEN** the tool returns an error indicating `isTrue` is not valid for freeform questions
