## ADDED Requirements

### Requirement: contexts configuration axis

The system SHALL accept an optional `contexts` configuration field at three cascade tiers: `config.trivia.contexts`, `SeasonEntry.contexts`, and `SeasonFormatSlot.contexts`. The value SHALL be an array of `{ name: string; weight?: number }` entries, where:

- `name` MUST be a string (possibly empty — the empty string is a first-class value meaning "no specific lean").
- `weight`, when present, MUST be a positive number; when absent, defaults to `1`.
- The array MUST contain at least one entry when present.
- Within a single `contexts` array, all `name` values MUST be unique (whitespace-trimmed, case-sensitive).

Resolution priority on each `get_ideas` call SHALL be: slot → season → config. When no tier provides `contexts`, the system SHALL treat the contexts axis as absent (no `contextPriority` is rolled or returned).

#### Scenario: contexts absent at every tier

- **GIVEN** no `contexts` is set at config, season, or slot level
- **WHEN** `get_ideas` is called
- **THEN** the response does not include `contextPriority`

#### Scenario: contexts set at config level

- **GIVEN** `config.trivia.contexts` is `[{ name: "Quebec", weight: 5 }, { name: "International", weight: 1 }]` and no season/slot override
- **WHEN** `get_ideas` is called
- **THEN** the response includes `contextPriority` of length 2

#### Scenario: Season contexts overrides config

- **GIVEN** the current season has `contexts: [{ name: "academic" }]` and `config.trivia.contexts` is `[{ name: "Quebec" }]`
- **WHEN** `get_ideas` is called
- **THEN** `contextPriority` is `["academic"]`

#### Scenario: Slot contexts overrides season

- **GIVEN** the active season has `contexts: [{ name: "Quebec" }]` and `format.questions[0].contexts: [{ name: "pop culture" }]`
- **WHEN** `get_ideas` is called with `slot: 0`
- **THEN** `contextPriority` is `["pop culture"]`

#### Scenario: Empty-name context permitted

- **GIVEN** `contexts: [{ name: "Quebec", weight: 3 }, { name: "", weight: 1 }]`
- **WHEN** `get_ideas` is called
- **THEN** `contextPriority` contains both `"Quebec"` and `""` in some order

#### Scenario: Empty contexts array rejected

- **GIVEN** `config.trivia.contexts` is `[]`
- **WHEN** the config is loaded
- **THEN** the system rejects the config with a validation error indicating contexts must be non-empty when present

#### Scenario: Duplicate names rejected

- **GIVEN** `config.trivia.contexts` is `[{ name: "Quebec" }, { name: "Quebec" }]`
- **WHEN** the config is loaded
- **THEN** the system rejects the config with a validation error indicating duplicate context names

#### Scenario: Non-positive weight rejected

- **GIVEN** `config.trivia.contexts` is `[{ name: "Quebec", weight: 0 }]`
- **WHEN** the config is loaded
- **THEN** the system rejects the config with a validation error indicating weights must be positive

### Requirement: contextPriority is a weighted-random ordered priority list

When `contexts` is resolved at any cascade tier on a `get_ideas` call, the system SHALL produce `contextPriority: string[]` by performing weighted random sampling without replacement of the resolved contexts. Each call SHALL freshly roll the order — there SHALL be no caching across calls. The result SHALL be a permutation of every resolved context's `name`. Probability of a context appearing at index 0 SHALL be proportional to its weight relative to total weight of remaining contexts at each step.

#### Scenario: Order varies across calls

- **GIVEN** `contexts: [{ name: "Quebec", weight: 5 }, { name: "International", weight: 1 }]`
- **WHEN** `get_ideas` is called many times
- **THEN** `contextPriority[0]` is `"Quebec"` approximately 5/6 of the time and `"International"` approximately 1/6 of the time

#### Scenario: contextPriority is a complete permutation

- **GIVEN** `contexts: [{ name: "A" }, { name: "B" }, { name: "C" }]`
- **WHEN** `get_ideas` is called
- **THEN** `contextPriority` has length 3 and is a permutation of `["A", "B", "C"]`

#### Scenario: Each call rolls independently

- **WHEN** `get_ideas` is called twice in the same scheduled run
- **THEN** the two `contextPriority` arrays may differ in order

### Requirement: Prompt instructs Claude to descend the priority list

The scheduled question-posting prompt SHALL instruct Claude to:

1. Treat `contextPriority[0]` as the preferred lens and use it as the slant when drafting the question (the question text should reflect or be informed by that lens).
2. When the current lens yields no usable question (topical: no recent newsworthy event; fact: no interesting angle within that lens), descend to `contextPriority[1]`, then `[2]`, etc.
3. The empty-string entry, when reached, indicates "no specific lean" — Claude generates without applying a lens to the statement.
4. The priority list is exhaustively tried; only after every entry has been attempted (including the empty-string entry if present) does the prompt instruct Claude to re-call `get_ideas`.

#### Scenario: Prompt requires using contextPriority[0] first

- **GIVEN** `contextPriority: ["Quebec", "International", ""]`
- **WHEN** the prompt branches
- **THEN** the prompt instructs Claude to attempt the question with `"Quebec"` as the lens first

#### Scenario: Empty-string lens means no slant

- **GIVEN** Claude has descended to an empty-string entry in `contextPriority`
- **WHEN** the prompt evaluates that step
- **THEN** the prompt instructs Claude to generate the question without applying a lens

#### Scenario: No contextPriority means no lens applied

- **GIVEN** the response does not include `contextPriority`
- **WHEN** the prompt branches
- **THEN** the prompt makes no mention of a lens, and Claude generates as it does today

### Requirement: save_question stores and validates the used context

The `save_question` MCP tool SHALL accept an optional `context: string` argument indicating which lens (from `contextPriority`) was used to write the question. When provided, the tool SHALL validate that:

- The value is a string (the empty string is a valid value).
- When non-empty, the value MUST appear in the active `contexts` resolved for the current question's slot/season/config (case-sensitive match against the `name` field of any entry).

When `context` is an empty string OR is not provided, the tool SHALL omit the `context` field on the persisted record. When `context` is a non-empty string that passes validation, the tool SHALL persist `context: string` on the question record.

#### Scenario: Valid non-empty context stored

- **GIVEN** the active `contexts` is `[{ name: "Quebec" }, { name: "International" }]`
- **WHEN** `save_question` is called with `context: "Quebec"`
- **THEN** the stored record has `context: "Quebec"`

#### Scenario: Empty-string context omitted from record

- **WHEN** `save_question` is called with `context: ""`
- **THEN** the stored record has no `context` field

#### Scenario: Context not in active list rejected

- **GIVEN** the active `contexts` is `[{ name: "Quebec" }]`
- **WHEN** `save_question` is called with `context: "International"`
- **THEN** the tool returns a validation error indicating the context is not in the active list

#### Scenario: Context absent when contexts not configured

- **GIVEN** no `contexts` is configured at any cascade tier
- **WHEN** `save_question` is called without a `context` argument
- **THEN** the question is saved with no `context` field

#### Scenario: Context provided when contexts not configured is rejected

- **GIVEN** no `contexts` is configured at any cascade tier
- **WHEN** `save_question` is called with `context: "Quebec"`
- **THEN** the tool returns a validation error indicating contexts are not configured for this question's slot/season
