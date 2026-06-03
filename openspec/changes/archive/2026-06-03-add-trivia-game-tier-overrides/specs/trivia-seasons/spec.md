## MODIFIED Requirements

### Requirement: Per-season question format

When `seasons.enabled` is `true`, the Trivia plugin SHALL accept an optional `format` field on each season entry. When present, the field MUST conform to:

```
format: {
  questions: Array<{
    label?: string,
    categories?: string[],
    answersFormat?: Record<"boolean" | "choice", number>,
    questionType?: Record<"fact" | "topical", number>,
    contexts?: Array<{ name: string; weight?: number }>
  }>
}
```

Invariants:

1. `format.questions` MUST be a non-empty array.
2. Each slot's `label`, when present, MUST be a non-empty string after trim.
3. Each slot's `categories`, when present, MUST be a non-empty array of strings (deduped, preserving first-occurrence order).
4. Each slot's `answersFormat`, when present, MUST contain only the keys `"boolean"` and `"choice"`, each mapped to a non-negative integer, AND at least one key MUST be mapped to a strictly positive value.
5. Each slot's `questionType`, when present, MUST contain only the keys `"fact"` and `"topical"`, with the same positive-weight invariant.
6. Each slot's `contexts`, when present, MUST be a non-empty array with the same name/weight invariants as the season-level `contexts`.
7. All slot fields are optional individually; an entirely empty slot (`{}`) is permitted and means "use season defaults for everything".

Resolution for a question-cron fire SHALL follow the cascade: `season.format → game.format → (single-question fallback)`. The first present tier wins as a whole. When neither the season nor the game provides a `format`, the cron fire SHALL post a single question rolled from the season's `categories`, `answersFormat`, `questionType`, and `contexts`.

When a season's `format` is present, each question-cron fire SHALL post `format.questions.length` questions (one per slot, in array order). The same applies when the game's `format` is present and the season's is absent — the game's slot count drives the fire's posted count.

#### Scenario: No season format and no game format behaves as pre-format

- **GIVEN** a season entry with no `format` field and a game entry with no `format` field
- **WHEN** the question cron fires
- **THEN** a single question is posted using the resolved `categories`, `answersFormat`, `questionType`, and `contexts`

#### Scenario: Season with format posts one question per slot

- **GIVEN** a season entry with `format: { questions: [{ label: "GK 1" }, { label: "History Choice", answersFormat: { boolean: 0, choice: 1 } }] }`
- **WHEN** the question cron fires
- **THEN** exactly two questions are posted in that order

#### Scenario: Season format wins over game format

- **GIVEN** game `main` has `format: { questions: [{}] }` (1 slot) and the active season has `format: { questions: [{}, {}, {}] }` (3 slots)
- **WHEN** the question cron fires for game `main`
- **THEN** exactly three questions are posted (season tier takes precedence)

#### Scenario: Game format used when season has none

- **GIVEN** the active season has no `format` field and game `main` has `format: { questions: [{}, {}] }` (2 slots)
- **WHEN** the question cron fires for game `main`
- **THEN** exactly two questions are posted

#### Scenario: Slot can override questionType

- **GIVEN** a season with `questionType: { fact: 1 }` and `format: { questions: [{}, { questionType: { topical: 1 } }] }`
- **WHEN** `get_ideas` is called with `slot: 1`
- **THEN** `suggestedQuestionType` is always `"topical"`

#### Scenario: Slot can override contexts

- **GIVEN** a season with `contexts: [{ name: "Quebec" }]` and `format: { questions: [{ contexts: [{ name: "academic" }] }] }`
- **WHEN** `get_ideas` is called with `slot: 0`
- **THEN** `contextPriority` is `["academic"]`

#### Scenario: Empty questions array rejected on write

- **WHEN** `upsert_season` is called with `format: { questions: [] }`
- **THEN** the call is rejected

#### Scenario: Invalid slot.answersFormat rejected

- **WHEN** `upsert_season` is called with `format: { questions: [{ answersFormat: { boolean: 0, choice: 0 } }] }`
- **THEN** the call is rejected with an "answersFormat must have at least one positive weight" error

#### Scenario: Invalid slot.questionType rejected

- **WHEN** `upsert_season` is called with `format: { questions: [{ questionType: { fact: 0, topical: 0 } }] }`
- **THEN** the call is rejected with a "questionType must have at least one positive weight" error

#### Scenario: Empty slot is permitted

- **WHEN** `upsert_season` is called with `format: { questions: [{}] }`
- **THEN** the call succeeds; the slot inherits all defaults from the season at posting time

### Requirement: save_question slot binding

When the active season has a `format` OR the game has a `format` (with season absent), the `save_question` MCP tool SHALL require a `slot: { index: number, label?: string }` argument. The tool SHALL:

1. Reject the call with a structured "slot required" error if `slot` is omitted.
2. Reject the call with a structured "slot index out of range" error if `slot.index` is not in `[0, format.questions.length)` where `format` is the effective format from the `season.format → game.format` cascade.
3. Resolve the slot's effective `answersFormat` via the cascade `slot.answersFormat ?? season.answersFormat ?? game.answersFormat ?? config.trivia.answersFormat` and reject the call with an "answers format not permitted by slot" error if the question's actual `answersFormat` value is not in the slot's permitted set (weight > 0).
4. Resolve the slot's effective `questionType` via the cascade `slot.questionType ?? season.questionType ?? game.questionType ?? config.trivia.questionType` and reject the call with a "question type not permitted by slot" error if the question's actual `questionType` value is not in the slot's permitted set (weight > 0).
5. Resolve the slot's effective `categories` via the cascade `slot.categories ?? season.categories ?? game.categories` and reject the call with a "category not in slot pool" error if the question's `category` is not in that resolved pool. When none of the three tiers supplies categories, the global `categories.json` is the active pool.
6. Resolve the slot's effective `contexts` via the cascade `slot.contexts ?? season.contexts ?? game.contexts ?? config.trivia.contexts` (may be absent) and reject the call with a "context not in slot lens list" error if a non-empty `context` argument is provided but does not appear in the resolved contexts list.
7. Snapshot `slot: { index, label }` onto the saved question record where `label` is taken from the resolved `format.questions[index].label` at the moment of write.

When neither the active season nor the game has a `format`, the `save_question` tool SHALL reject any `slot` argument with a structured "no active format" error.

#### Scenario: Save with valid slot succeeds and snapshots label

- **GIVEN** the active season has `format: { questions: [{ label: "GK 1" }, { label: "History Choice", categories: ["History"], answersFormat: { choice: 1 } }] }`
- **WHEN** `save_question` is called with `slot: { index: 1 }`, `answersFormat: "choice"`, `questionType: "fact"`, `category: "History"`, valid choices/correctIndex
- **THEN** the call succeeds and the saved record carries `slot: { index: 1, label: "History Choice" }`

#### Scenario: Save with valid slot using game format

- **GIVEN** the active season has no `format` and game `main` has `format: { questions: [{ label: "Daily" }] }`
- **WHEN** `save_question` is called with `game: "main", slot: { index: 0 }`, valid payload
- **THEN** the call succeeds and the saved record carries `slot: { index: 0, label: "Daily" }`

#### Scenario: Missing slot argument when format present

- **GIVEN** the active season has a `format` (or the game has a format with no season format)
- **WHEN** `save_question` is called with no `slot` argument
- **THEN** the call is rejected with a "slot required" error

#### Scenario: Slot index out of range

- **WHEN** `save_question` is called with `slot: { index: 99 }` and the effective format has 2 slots
- **THEN** the call is rejected with a "slot index out of range" error

#### Scenario: Answers format not permitted by slot

- **GIVEN** the effective format's slot 0 has `answersFormat: { choice: 1 }` (boolean weight 0)
- **WHEN** `save_question` is called with `slot: { index: 0 }, answersFormat: "boolean", ...`
- **THEN** the call is rejected with an "answers format not permitted by slot" error

#### Scenario: Question type not permitted by slot

- **GIVEN** the effective format's slot 0 has `questionType: { fact: 1 }` (topical weight 0)
- **WHEN** `save_question` is called with `slot: { index: 0 }, questionType: "topical", ...`
- **THEN** the call is rejected with a "question type not permitted by slot" error

#### Scenario: Category not in slot's resolved pool

- **GIVEN** the effective format's slot 0 has `categories: ["History"]`
- **WHEN** `save_question` is called with `slot: { index: 0 }, category: "Science"`
- **THEN** the call is rejected with a "category not in slot pool" error

#### Scenario: Context not in slot's lens list

- **GIVEN** the effective format's slot 0 has `contexts: [{ name: "Quebec" }]`
- **WHEN** `save_question` is called with `slot: { index: 0 }, context: "International"`
- **THEN** the call is rejected with a "context not in slot lens list" error

#### Scenario: Slot argument rejected when no format is active

- **GIVEN** the active season has no `format` AND the game has no `format`
- **WHEN** `save_question` is called with any `slot` argument
- **THEN** the call is rejected with a "no active format" error
