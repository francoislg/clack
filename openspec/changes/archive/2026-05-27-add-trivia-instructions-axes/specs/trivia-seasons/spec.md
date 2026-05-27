## ADDED Requirements

### Requirement: `instructions` and `additionalInstructions` fields on SeasonEntry

The `SeasonEntry` type SHALL support two new OPTIONAL string fields: `instructions` and `additionalInstructions`. Both fields cascade per the rules defined in `trivia-prompt-instructions`. Both fields MUST be persisted in `data/plugins/trivia/games/<name>/seasons.json` when set.

#### Scenario: Season carries both fields independently

- **WHEN** a season is upserted with both fields set
- **THEN** the persisted `SeasonEntry` SHALL include both fields with their trimmed string values

#### Scenario: Mid-season mutation permitted

- **WHEN** an admin updates a started season with new `instructions` or `additionalInstructions` values
- **THEN** the upsert SHALL accept the change without rejecting on startedAt grounds (same policy as `theme` and the other narrative axes)

#### Scenario: Fields are independently optional

- **WHEN** a season is upserted with only one of the two fields set
- **THEN** the persisted `SeasonEntry` SHALL include only the field that was set

### Requirement: `instructions` and `additionalInstructions` fields on SeasonFormatSlot

The `SeasonFormatSlot` type SHALL support two new OPTIONAL string fields: `instructions` and `additionalInstructions`. Both fields cascade per the rules defined in `trivia-prompt-instructions`. The `validateFormat` parser SHALL accept and validate both fields per slot using the same lenient drop-on-invalid policy as `theme`.

#### Scenario: Slot carries both fields

- **WHEN** an active season's `format.questions[2]` slot declares both fields
- **THEN** the parsed `SeasonFormatSlot` SHALL include both fields with their trimmed string values

#### Scenario: Slot fields are independent from season-tier fields

- **WHEN** a season sets `instructions: "Halloween-themed."` AND slot 1 sets `instructions: "Keep it easy."`
- **THEN** both values SHALL be persisted on their respective tiers; the resolver applies the slot-wins cascade rule at runtime (defined in `trivia-prompt-instructions`)

#### Scenario: Whitespace-only slot field drops with a logged issue

- **WHEN** a slot declares `instructions: "   "` (whitespace only)
- **THEN** the parser SHALL drop the slot's `instructions` field, log an issue, AND retain every other valid slot field
