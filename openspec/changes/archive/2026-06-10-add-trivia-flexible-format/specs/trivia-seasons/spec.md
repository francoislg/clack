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
  }>,
  flexible?: boolean
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
8. `format.flexible`, when present, MUST be a boolean. When absent it reads as `false`. The same field is accepted identically on a game-tier `format`.

Resolution for a question-cron fire SHALL follow the cascade: `season.format → game.format → (single-question fallback)`. The first present tier wins as a whole (including its `flexible` value). When neither the season nor the game provides a `format`, the cron fire SHALL post a single question rolled from the season's `categories`, `answersFormat`, `questionType`, and `contexts`.

When the resolved `format` is NOT flexible (`flexible` absent or `false`), each question-cron fire SHALL post `format.questions.length` questions (one per slot, in array order). The same applies when the game's `format` is present and the season's is absent — the game's slot count drives the fire's posted count.

When the resolved `format` has `flexible: true`, each question-cron fire SHALL post a PREFIX of the slots — between `0` and `format.questions.length` questions inclusive, filled in array order — with the count chosen during generation by available material. Posting fewer than `questions.length` (including zero, which skips the day) is valid. Slot definitions and `save_question` index validation (`[0, questions.length)`) are unchanged.

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

#### Scenario: Flexible format posts a prefix when material is thin

- **GIVEN** the active season has no `format` and game `main` has `format: { questions: [{}, {}, {}], flexible: true }`
- **AND** usable material exists for slots 0 and 1 but not slot 2
- **WHEN** the question cron fires for game `main`
- **THEN** exactly two questions are posted (slots 0 and 1)

#### Scenario: Flexible format posts zero and skips the day

- **GIVEN** game `main` has `format: { questions: [{}], flexible: true }` and no usable material this fire
- **WHEN** the question cron fires for game `main`
- **THEN** zero questions are posted and the run terminates cleanly with no error

#### Scenario: Flexible flag accepted on write

- **WHEN** `upsert_season` is called with `format: { questions: [{}, {}], flexible: true }`
- **THEN** the call succeeds and the stored season format carries `flexible: true`

#### Scenario: Non-boolean flexible rejected on write

- **WHEN** `upsert_season` is called with `format: { questions: [{}], flexible: "sometimes" }`
- **THEN** the call is rejected with an error identifying `format.flexible` as needing a boolean

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
