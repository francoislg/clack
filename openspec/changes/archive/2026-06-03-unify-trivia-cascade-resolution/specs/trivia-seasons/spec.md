## ADDED Requirements

### Requirement: Season per-slot overrides via sparse slotOverrides map

A season MAY carry an optional `slotOverrides` map — `{ [slotIndex: number]: PartialSlotAxes }` — expressing per-slot field overrides layered over the game format's slots. When present, it SHALL be resolved as the `seasonSlot` tier of the cascade. Each value is a partial bag of the same per-question cascade axes a `SeasonFormatSlot` can carry (`answersFormat`, `questionType`, `promptMedium`, `freeformAnswerShape`, `contexts`, `difficulty`, `difficultyRatio`, `hint`, `judgeLeniency`, `instructions`, `additionalInstructions`, `liveAnswersVisible`, `revealResponses`, plus `categories`/`label`). The map is the `seasonSlot` tier in the cascade (`seasonSlot → season → gameSlot → game → workspace → default`): for slot index `i`, `slotOverrides[i]` overrides `game.format.questions[i]` field-by-field; fields the override leaves unset inherit the game slot.

`slotOverrides` SHALL be **count-decoupled**: it changes only the addressed slots' fields and never the number of questions a fire posts. The question count remains `game.format.questions.length` (or 1 when the game has no format). A season changes the count only by declaring its own structural `format`.

A season SHALL NOT set both `slotOverrides` and a structural `format`; the parser SHALL reject a season that sets both (v1 mutual exclusivity). The values in `slotOverrides` SHALL be validated by the same per-axis validators used for a `SeasonFormatSlot`.

#### Scenario: Override a single slot field without restating the list

- **WHEN** a game defines a 3-slot `format` and the active season sets `slotOverrides: { "2": { promptMedium: { image: 1 } } }`
- **THEN** slot 2 resolves `promptMedium` to `{ image: 1 }` (from `seasonSlot`)
- **AND** slots 0 and 1 inherit their full config from the game format
- **AND** the fire still posts 3 questions (the count is unchanged)

#### Scenario: Slot override inherits unset fields from the game slot

- **WHEN** the game slot 2 sets `answersFormat`, `difficulty`, and `category` and the season's `slotOverrides[2]` sets only `promptMedium`
- **THEN** slot 2 resolves `promptMedium` from the season override and `answersFormat`/`difficulty`/`category` from the game slot

#### Scenario: slotOverrides for an index the game format lacks

- **WHEN** the season sets `slotOverrides[5]` but the game format has only 3 slots
- **THEN** the override has no game slot to layer over (`gameSlot[5]` is `null`), and any axis it does not set falls through `seasonSlot → season → gameSlot (null) → game → workspace → default`
- **AND** the count is unaffected (still the game's)

#### Scenario: Both slotOverrides and a structural format is rejected

- **WHEN** `upsert_season` is called with both `slotOverrides` and `format` set
- **THEN** the tool returns a structured error stating the two are mutually exclusive on a season

#### Scenario: slotOverrides is surfaced for audit

- **WHEN** `list_seasons` reports a season carrying `slotOverrides`
- **THEN** the response includes the per-slot override map so an admin can audit it without rolling
