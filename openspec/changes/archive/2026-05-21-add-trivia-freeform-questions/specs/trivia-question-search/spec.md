## ADDED Requirements

### Requirement: save_question Accepts Freeform Fields

`save_question` SHALL accept `expectedAnswer: string` (required when `answersFormat: "freeform"`, forbidden otherwise), `acceptableAnswers?: string[]` (optional, freeform-only), and `gradingNotes?: string` (optional, freeform-only). The discriminator validation SHALL enforce that:

- `answersFormat: "freeform"` requires `expectedAnswer` and forbids `isTrue`, `choices`, `correctIndex`.
- `answersFormat: "boolean"` and `answersFormat: "choice"` forbid `expectedAnswer`, `acceptableAnswers`, `gradingNotes`.

The cross-format error messages SHALL identify the offending field and the active `answersFormat` so Claude can correct the call.

#### Scenario: Freeform save with required field

- **WHEN** `save_question` is called with `answersFormat: "freeform"`, `statement: "What is the capital of France?"`, and `expectedAnswer: "Paris"`
- **THEN** the question record is saved with those fields
- **AND** the response carries the saved record's id

#### Scenario: Freeform save with optional fields

- **WHEN** `save_question` is called with `answersFormat: "freeform"`, `expectedAnswer: "Paris"`, `acceptableAnswers: ["Paris, France", "City of Paris"]`, and `gradingNotes: "Accept any reasonable English-language form of the city name."`
- **THEN** the saved record carries all three freeform-specific fields

#### Scenario: Freeform save missing expectedAnswer

- **WHEN** `save_question` is called with `answersFormat: "freeform"` and no `expectedAnswer`
- **THEN** the tool returns an error identifying `expectedAnswer` as required for freeform questions
- **AND** no record is written

#### Scenario: Boolean save with freeform field

- **WHEN** `save_question` is called with `answersFormat: "boolean"`, `isTrue: true`, and `expectedAnswer: "Paris"` (mistakenly supplied)
- **THEN** the tool returns an error identifying `expectedAnswer` as not valid for boolean questions
- **AND** no record is written

#### Scenario: Freeform save with cross-format field

- **WHEN** `save_question` is called with `answersFormat: "freeform"` and `choices: ["a", "b"]` (mistakenly supplied)
- **THEN** the tool returns an error identifying `choices` as not valid for freeform questions
- **AND** no record is written
