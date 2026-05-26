## ADDED Requirements

### Requirement: liveAnswersVisible on season and slot

`SeasonEntry` and each slot entry within `SeasonFormat.questions[]` SHALL accept an optional `liveAnswersVisible: boolean` field. When present, these values participate in the `liveAnswersVisible` cascade resolved at `post_questions` time:

```
slot.liveAnswersVisible          (highest precedence — within SeasonFormat.questions[i])
  → season.liveAnswersVisible    (on SeasonEntry)
    → game.liveAnswersVisible    (on TriviaGame, per trivia-games spec)
      → config.trivia.liveAnswersVisible (workspace level)
        → true (default)
```

The fields SHALL be parsed by the seasons-state loader and the `upsert_season` MCP tool with the following rules:

- Absence at any tier is valid — the cascade falls through.
- Non-boolean values SHALL be rejected on `upsert_season` write attempts with a structured error.
- Explicit `null` on `upsert_season` SHALL clear the field (same convention as `theme`, `answersFormat`, `questionType`, `contexts`, `format`). Omitting the field on UPDATE leaves the existing value intact.
- Mutation post-`startedAt` is permitted — the cascade resolves at post-time per question, and questions already posted are stamped with the value resolved AT post-time, so mid-season edits do not affect already-posted questions.

`upsert_season`'s return shape SHALL include `hasLiveAnswersVisible: boolean` (true iff the resulting entry has an explicit value).

`list_seasons` SHALL surface per-season `liveAnswersVisible` and per-slot `liveAnswersVisible` when set.

#### Scenario: Season-level value resolves through cascade

- **GIVEN** a season entry with `liveAnswersVisible: false`, no slot override, game default-absent, workspace default-true
- **WHEN** `post_questions` posts a question into this season
- **THEN** the stamped value is `false`

#### Scenario: Slot-level value beats season

- **GIVEN** a season with `liveAnswersVisible: false` and a 2-slot format where `questions[1]` has `liveAnswersVisible: true`
- **WHEN** `post_questions` posts the slot-1 question
- **THEN** the stamped value is `true` (slot wins)

#### Scenario: upsert_season creates a season with the field

- **WHEN** `upsert_season(game: "main", slug: "june-2026", startedAt: <T>, expectedEndAt: <T'>, liveAnswersVisible: false)` is called
- **THEN** the season is created with `liveAnswersVisible: false`
- **AND** the response carries `hasLiveAnswersVisible: true`

#### Scenario: upsert_season clears the field with null

- **GIVEN** an existing season with `liveAnswersVisible: false`
- **WHEN** `upsert_season(game, slug, { liveAnswersVisible: null })` is called
- **THEN** the field is removed from the entry
- **AND** the response carries `hasLiveAnswersVisible: false`

#### Scenario: Non-boolean value rejected on upsert

- **WHEN** `upsert_season(game, slug, { liveAnswersVisible: "false" })` is called (string, not boolean)
- **THEN** the call is rejected with a structured "liveAnswersVisible must be boolean" error
- **AND** no write occurs

#### Scenario: Mid-season edit does not affect already-posted questions

- **GIVEN** `Q1` was posted yesterday with stamped `liveAnswersVisible: true`
- **WHEN** an admin updates the season's `liveAnswersVisible` to `false` today
- **AND** a user clicks a vote button on `Q1` today
- **THEN** `Q1`'s roster footer rebuilds in visible mode (per its stamped value)
- **AND** a NEW question posted today receives the new `false` value

#### Scenario: Slot-level field accepted on upsert_season

- **WHEN** `upsert_season(game, slug, { format: { questions: [{ label: "A", liveAnswersVisible: false }, { label: "B" }] } })` is called
- **THEN** the season is written with slot 0 carrying `liveAnswersVisible: false` and slot 1 with no override
- **AND** `list_seasons` shows the slot-0 override but not slot-1

### Requirement: revealResponses on season and slot

`SeasonEntry` and each slot entry within `SeasonFormat.questions[]` SHALL accept an optional `revealResponses: "no" | "just-correctness" | "yes"` field. When present, these values participate in the `revealResponses` cascade resolved at `post_questions` time:

```
slot.revealResponses          (highest precedence — within SeasonFormat.questions[i])
  → season.revealResponses    (on SeasonEntry)
    → game.revealResponses    (on TriviaGame, per trivia-games spec)
      → config.trivia.revealResponses (workspace level)
        → "yes" (default)
```

The fields SHALL be parsed by the seasons-state loader and the `upsert_season` MCP tool with the following rules:

- Absence at any tier is valid — the cascade falls through.
- Values other than the three string literals SHALL be rejected on `upsert_season` write attempts with a structured error.
- Explicit `null` on `upsert_season` SHALL clear the field. Omitting the field on UPDATE leaves the existing value intact.
- Mutation post-`startedAt` is permitted — the cascade resolves at post-time per question.

`upsert_season`'s return shape SHALL include `hasRevealResponses: boolean` (true iff the resulting entry has an explicit value).

`list_seasons` SHALL surface per-season `revealResponses` and per-slot `revealResponses` when set.

#### Scenario: Season-level value resolves through cascade

- **GIVEN** a season entry with `revealResponses: "just-correctness"`, no slot override, game default-absent, workspace default-"yes"
- **WHEN** `post_questions` posts a question into this season
- **THEN** the stamped value is `"just-correctness"`

#### Scenario: Slot-level value beats season

- **GIVEN** a season with `revealResponses: "no"` and a 2-slot format where `questions[1]` has `revealResponses: "yes"`
- **WHEN** `post_questions` posts the slot-1 question
- **THEN** the stamped value is `"yes"` (slot wins)

#### Scenario: upsert_season creates a season with revealResponses

- **WHEN** `upsert_season(game: "main", slug: "june-2026", startedAt: <T>, expectedEndAt: <T'>, revealResponses: "no")` is called
- **THEN** the season is created with `revealResponses: "no"`
- **AND** the response carries `hasRevealResponses: true`

#### Scenario: upsert_season clears revealResponses with null

- **GIVEN** an existing season with `revealResponses: "no"`
- **WHEN** `upsert_season(game, slug, { revealResponses: null })` is called
- **THEN** the field is removed from the entry
- **AND** the response carries `hasRevealResponses: false`

#### Scenario: Invalid revealResponses string rejected on upsert

- **WHEN** `upsert_season(game, slug, { revealResponses: "maybe" })` is called
- **THEN** the call is rejected with a structured error
- **AND** no write occurs

#### Scenario: Non-string revealResponses rejected on upsert

- **WHEN** `upsert_season(game, slug, { revealResponses: false })` is called
- **THEN** the call is rejected with a structured "revealResponses must be one of \"no\", \"just-correctness\", \"yes\"" error

#### Scenario: Slot-level revealResponses accepted on upsert_season

- **WHEN** `upsert_season(game, slug, { format: { questions: [{ label: "A", revealResponses: "no" }, { label: "B" }] } })` is called
- **THEN** the season is written with slot 0 carrying `revealResponses: "no"` and slot 1 with no override
- **AND** `list_seasons` shows the slot-0 override but not slot-1

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
    contexts?: Array<{ name: string; weight?: number }>,
    liveAnswersVisible?: boolean,
    revealResponses?: "no" | "just-correctness" | "yes"
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
7. Each slot's `liveAnswersVisible`, when present, MUST be a boolean. Non-boolean values SHALL be rejected.
8. Each slot's `revealResponses`, when present, MUST be one of `"no"`, `"just-correctness"`, or `"yes"`. Other values SHALL be rejected.
9. All slot fields are optional individually; an entirely empty slot (`{}`) is permitted and means "use season defaults for everything".

When a season's `format` is absent, the season SHALL behave as before this change: each question-cron fire posts a single question rolled from the season's `categories`, `answersFormat`, `questionType`, `contexts`, and `liveAnswersVisible`.

When a season's `format` is present, each question-cron fire SHALL post `format.questions.length` questions (one per slot, in array order). Each slot's `liveAnswersVisible`, when set, is the highest-precedence value in the cascade for that question.

#### Scenario: Season without format behaves as before

- **GIVEN** a season entry with no `format` field
- **WHEN** the question cron fires
- **THEN** a single question is posted using the season's `categories`, `answersFormat`, `questionType`, `contexts`, `liveAnswersVisible`, and `revealResponses` resolutions

#### Scenario: Season with format posts one question per slot

- **GIVEN** a season entry with `format: { questions: [{ label: "GK 1" }, { label: "History Choice", answersFormat: { boolean: 0, choice: 1 } }] }`
- **WHEN** the question cron fires
- **THEN** exactly two questions are posted in that order

#### Scenario: Slot can override questionType

- **GIVEN** a season with `questionType: { fact: 1 }` and `format: { questions: [{}, { questionType: { topical: 1 } }] }`
- **WHEN** `get_ideas` is called with `slot: 1`
- **THEN** `suggestedQuestionType` is always `"topical"`

#### Scenario: Slot can override contexts

- **GIVEN** a season with `contexts: [{ name: "Quebec" }]` and `format: { questions: [{ contexts: [{ name: "academic" }] }] }`
- **WHEN** `get_ideas` is called with `slot: 0`
- **THEN** `contextPriority` is `["academic"]`

#### Scenario: Slot can override liveAnswersVisible

- **GIVEN** a season with `liveAnswersVisible: true` and `format: { questions: [{}, { liveAnswersVisible: false }] }`
- **WHEN** `post_questions` posts the slot-1 question
- **THEN** the question record is stamped `liveAnswersVisible: false`

#### Scenario: Empty questions array rejected on write

- **WHEN** `upsert_season` is called with `format: { questions: [] }`
- **THEN** the call is rejected

#### Scenario: Invalid slot.answersFormat rejected

- **WHEN** `upsert_season` is called with `format: { questions: [{ answersFormat: { boolean: 0, choice: 0 } }] }`
- **THEN** the call is rejected with an "answersFormat must have at least one positive weight" error

#### Scenario: Invalid slot.questionType rejected

- **WHEN** `upsert_season` is called with `format: { questions: [{ questionType: { fact: 0, topical: 0 } }] }`
- **THEN** the call is rejected with a "questionType must have at least one positive weight" error

#### Scenario: Invalid slot.liveAnswersVisible rejected

- **WHEN** `upsert_season` is called with `format: { questions: [{ liveAnswersVisible: "false" }] }`
- **THEN** the call is rejected with a structured "slot.liveAnswersVisible must be boolean" error

#### Scenario: Slot can override revealResponses

- **GIVEN** a season with `revealResponses: "yes"` and `format: { questions: [{}, { revealResponses: "no" }] }`
- **WHEN** `post_questions` posts the slot-1 question
- **THEN** the question record is stamped `revealResponses: "no"`

#### Scenario: Invalid slot.revealResponses rejected

- **WHEN** `upsert_season` is called with `format: { questions: [{ revealResponses: "maybe" }] }`
- **THEN** the call is rejected with a structured error
- **AND** no write occurs

#### Scenario: Empty slot is permitted

- **WHEN** `upsert_season` is called with `format: { questions: [{}] }`
- **THEN** the call succeeds; the slot inherits all defaults from the season at posting time
