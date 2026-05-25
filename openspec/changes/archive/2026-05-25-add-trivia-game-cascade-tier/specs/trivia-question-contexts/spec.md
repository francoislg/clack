## MODIFIED Requirements

### Requirement: contexts configuration axis

The system SHALL accept an optional `contexts` configuration field at four cascade tiers: `config.trivia.contexts` (workspace), `TriviaGame.contexts` (per-game, NEW), `SeasonEntry.contexts` (per-season), and `SeasonFormatSlot.contexts` (per-slot). The value SHALL be an array of `{ name: string; weight?: number }` entries, where:

- `name` MUST be a string (possibly empty — the empty string is a first-class value meaning "no specific lean").
- `weight`, when present, MUST be a positive number; when absent, defaults to `1`.
- The array MUST contain at least one entry when present.
- Within a single `contexts` array, all `name` values MUST be unique (whitespace-trimmed, case-sensitive).

Resolution priority on each `get_ideas` call SHALL be: `slot → season → game → workspace`. When no tier provides `contexts`, the system SHALL treat the contexts axis as absent (no `contextPriority` is rolled or returned).

#### Scenario: contexts absent at every tier

- **GIVEN** no `contexts` is set at workspace, game, season, or slot level
- **WHEN** `get_ideas` is called
- **THEN** the response does not include `contextPriority`

#### Scenario: contexts set at config level

- **GIVEN** `config.trivia.contexts` is `[{ name: "Quebec", weight: 5 }, { name: "International", weight: 1 }]` and no game/season/slot override
- **WHEN** `get_ideas` is called
- **THEN** the response includes `contextPriority` of length 2

#### Scenario: Per-game contexts overrides workspace

- **GIVEN** `config.trivia.contexts` is `[{ name: "International" }]`
- **AND** `config.trivia.games[0].contexts` is `[{ name: "Quebec" }]`
- **AND** no season/slot override
- **WHEN** `get_ideas(game: "main")` is called
- **THEN** `contextPriority` is `["Quebec"]` (per-game tier wins over workspace)

#### Scenario: Season contexts overrides per-game

- **GIVEN** the current season has `contexts: [{ name: "academic" }]`
- **AND** `config.trivia.games[0].contexts` is `[{ name: "Quebec" }]`
- **WHEN** `get_ideas(game: "main")` is called
- **THEN** `contextPriority` is `["academic"]`

#### Scenario: Slot contexts overrides season

- **GIVEN** the active season has `contexts: [{ name: "Quebec" }]` and `format.questions[0].contexts: [{ name: "pop culture" }]`
- **WHEN** `get_ideas` is called with `slot: 0`
- **THEN** `contextPriority` is `["pop culture"]`

#### Scenario: Empty-name context permitted

- **GIVEN** `contexts: [{ name: "Quebec", weight: 3 }, { name: "", weight: 1 }]`
- **WHEN** `get_ideas` is called
- **THEN** `contextPriority` contains both `"Quebec"` and `""` in some order

#### Scenario: Empty contexts array rejected at every tier

- **GIVEN** a `contexts` field set to `[]` at any tier (workspace, game, season, or slot)
- **WHEN** the value is parsed
- **THEN** the parser rejects it with a validation error indicating contexts must be non-empty when present

#### Scenario: Duplicate names rejected

- **GIVEN** a `contexts` field with duplicate `name` values at any tier
- **WHEN** the value is parsed
- **THEN** the parser rejects it with a validation error indicating duplicate context names

#### Scenario: Non-positive weight rejected

- **GIVEN** a `contexts` field with `weight: 0` at any tier
- **WHEN** the value is parsed
- **THEN** the parser rejects it with a validation error indicating weights must be positive
