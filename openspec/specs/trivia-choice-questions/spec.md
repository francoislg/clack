# trivia-choice-questions

## Purpose

Add support for multiple-choice trivia questions alongside the existing boolean (true/false) questions. Supports per-season and global configuration of question-type weights, server-rolled choice metadata, and tailored reveal flows with proper voter categorization and multi-react voiding.

## Requirements

### Requirement: Answers-format discriminator

The system SHALL support two answer formats: `boolean` (true/false questions) and `choice` (multiple-choice questions). A `TriviaQuestion` record SHALL carry an `answersFormat: "boolean" | "choice"` field. When `answersFormat` is absent on a stored record (legacy pre-migration data only — the migration stamps it on all records), the system SHALL treat the record as `answersFormat: "boolean"`. When `answersFormat: "choice"`, the record SHALL carry `choices: string[]` (length 2–4) and `correctIndex: number` (0-based) and SHALL NOT carry `isTrue`. When `answersFormat: "boolean"`, the record SHALL carry `isTrue: boolean` and SHALL NOT carry `choices` or `correctIndex`.

#### Scenario: Legacy boolean record without answersFormat field

- **GIVEN** a `TriviaQuestion` record in `questions.json` with `isTrue: true` and no `answersFormat` field (pre-migration legacy only)
- **WHEN** any tool reads the record
- **THEN** the system treats it as a boolean question equivalent to `{ answersFormat: "boolean", isTrue: true, ... }`

#### Scenario: New boolean record carries answersFormat

- **WHEN** `save_question` saves a boolean question
- **THEN** the stored record has `answersFormat: "boolean"` and `isTrue` set, and lacks `choices` and `correctIndex`

#### Scenario: New choice record carries discriminated fields

- **WHEN** `save_question` saves a choice question with 4 choices and `correctIndex: 2`
- **THEN** the stored record has `answersFormat: "choice"`, `choices` of length 4, and `correctIndex: 2`, and lacks `isTrue`

### Requirement: Choice-question configuration

The system SHALL accept an optional `trivia.answersFormat` configuration block — a map from answers-format name (`"boolean"` or `"choice"`) to a non-negative integer weight — and an optional `choices` configuration block with numeric `min` and `max` fields (both must satisfy `2 ≤ min ≤ max ≤ 4`; built-in default when absent at every tier is `DEFAULT_TRIVIA_CHOICES`). The `choices` block is a cascading axis settable at the slot, season, game, and workspace (`trivia.choices`) tiers, validated identically at every tier. When `trivia.answersFormat` is absent or contains only the `"boolean"` key, the system SHALL behave identically to pre-choice deployments (no choice questions are generated).

#### Scenario: Default configuration generates boolean questions only

- **GIVEN** `data/config.json` has no `trivia.answersFormat` field
- **WHEN** `get_ideas` is called
- **THEN** the returned `suggestedAnswersFormat` is always `"boolean"`

#### Scenario: Mixed-format configuration generates both formats

- **GIVEN** `data/config.json` has `trivia.answersFormat: { "boolean": 2, "choice": 1 }`
- **WHEN** `get_ideas` is called many times
- **THEN** approximately 2/3 of calls return `suggestedAnswersFormat: "boolean"` and approximately 1/3 return `suggestedAnswersFormat: "choice"` (within statistical tolerance)

#### Scenario: Choice-only configuration

- **GIVEN** `data/config.json` has `trivia.answersFormat: { "choice": 1 }`
- **WHEN** `get_ideas` is called
- **THEN** the returned `suggestedAnswersFormat` is always `"choice"`

#### Scenario: Invalid choice bounds rejected at load

- **GIVEN** `data/config.json` has `trivia.choices: { min: 5, max: 10 }`
- **WHEN** the config is loaded
- **THEN** the system rejects the config with a validation error indicating bounds must satisfy `2 ≤ min ≤ max ≤ 4`

#### Scenario: Invalid choice bounds rejected at any tier

- **GIVEN** a game carries `choices: { min: 1, max: 4 }`
- **WHEN** the config is loaded (or `upsert_game` is called with those bounds)
- **THEN** the system rejects it with the same `2 ≤ min ≤ max ≤ 4` validation error used at the workspace tier

### Requirement: answersFormat is per-season, with config fallback

`questionsTypes` resolution at `get_ideas` time SHALL follow this priority:

1. If the seasons feature is enabled AND `findCurrentSeason(state, Date.now())` returns a non-null `SeasonEntry` whose `format` is present AND the resolved slot (per the call's `slot` argument, default `0`) has a `questionTypes` field set, use that slot's `questionTypes`.
2. Otherwise, if the seasons feature is enabled AND `findCurrentSeason` returns a non-null `SeasonEntry` whose `questionTypes` field is set, use that entry's `questionTypes`.
3. Otherwise (seasons disabled, `now` falls in a timeline gap, the current entry has no `format` or the slot has no `questionTypes`, AND the current entry has no top-level `questionTypes` field), use `config.trivia.questionsTypes`.
4. Otherwise (all sources absent), default to `{ "boolean": 1 }` (pure-boolean, equivalent to pre-change behavior).

The system SHALL re-read these sources on every `get_ideas` call — no caching, no pre-computation. The `choices.{min, max}` setting SHALL resolve through the full cascade (`slot → season → game → workspace → built-in default`) like every other cascade axis — see the dedicated "Choice option-count bounds cascade through all tiers" requirement.

#### Scenario: Slot's questionTypes overrides season's

- **GIVEN** seasons are enabled and the active season has `questionTypes: { boolean: 1, choice: 1 }` and `format: { questions: [{ questionTypes: { choice: 1 } }, {}] }`
- **WHEN** `get_ideas` is called with `slot: 0`
- **THEN** the resolved `questionTypes` is `{ choice: 1 }` (slot 0 overrides)
- **AND** `suggestedType` is always `"choice"`

#### Scenario: Slot without questionTypes falls back to season's

- **GIVEN** seasons are enabled and the active season has `questionTypes: { boolean: 2, choice: 1 }` and `format: { questions: [{}, {}] }`
- **WHEN** `get_ideas` is called with `slot: 1`
- **THEN** the resolved `questionTypes` is the season's `{ boolean: 2, choice: 1 }`

#### Scenario: Current season's questionTypes overrides config (no format)

- **GIVEN** seasons are enabled and `findCurrentSeason(state, now)` returns an entry with `questionTypes: { "choice": 1 }` and no `format`
- **AND** `config.trivia.questionsTypes` is `{ "boolean": 1 }`
- **WHEN** `get_ideas` is called
- **THEN** the returned `suggestedType` is always `"choice"`

#### Scenario: Current season without questionTypes or format falls back to config

- **GIVEN** seasons are enabled and the current `SeasonEntry` has no `questionTypes` field and no `format` field
- **AND** `config.trivia.questionsTypes` is `{ "boolean": 2, "choice": 1 }`
- **WHEN** `get_ideas` is called
- **THEN** the system uses `config.trivia.questionsTypes` weights for the random roll

#### Scenario: Timeline gap falls back to config

- **GIVEN** seasons are enabled but `findCurrentSeason(state, now)` returns `null` (now falls between seasons)
- **AND** `config.trivia.questionsTypes` is `{ "boolean": 2, "choice": 1 }`
- **WHEN** `get_ideas` is called
- **THEN** the system uses `config.trivia.questionsTypes` weights

#### Scenario: Seasons disabled uses config

- **GIVEN** seasons are disabled (`trivia.seasons.enabled: false` or absent)
- **AND** `config.trivia.questionsTypes` is `{ "boolean": 2, "choice": 1 }`
- **WHEN** `get_ideas` is called
- **THEN** the system uses `config.trivia.questionsTypes` weights for the random roll

#### Scenario: All sources absent defaults to boolean-only

- **GIVEN** seasons are enabled with no current entry questionTypes, no format, AND `config.trivia.questionsTypes` is absent
- **WHEN** `get_ideas` is called
- **THEN** the returned `suggestedType` is always `"boolean"`

#### Scenario: Mid-season format update via upsert_season takes effect on next call

- **GIVEN** `get_ideas(slot: 0)` was called once with no format
- **WHEN** `upsert_season(currentSlug, { format: { questions: [{ questionTypes: { choice: 1 } }] } })` is called and `get_ideas(slot: 0)` is called again
- **THEN** the second call uses the new slot 0's `questionTypes` of `{ choice: 1 }`

#### Scenario: Mid-season update via upsert_season takes effect on next call

- **GIVEN** `get_ideas` was called once with the current entry's previous `questionTypes`
- **WHEN** `upsert_season(currentSlug, { questionTypes: { "choice": 1 } })` is called and `get_ideas` is called again
- **THEN** the second call uses the updated weights

### Requirement: Server-rolled choice metadata in get_ideas

When `suggestedAnswersFormat` resolves to `"choice"`, `get_ideas` SHALL additionally return:

- `suggestedChoiceCount`: a uniform random integer in `[min, max]`, where `min` and `max` are the cascade-resolved choice bounds for the call's coordinate (`resolveCascade("choices", cascadeCtx)`: slot → season → game → workspace → built-in default).
- `suggestedCorrectIndex`: a uniform random integer in `[0, suggestedChoiceCount)`.

When `suggestedAnswersFormat` resolves to `"boolean"`, the boolean-path `suggestedAnswer` SHALL continue to be returned as before, and `suggestedChoiceCount` and `suggestedCorrectIndex` SHALL NOT be returned.

#### Scenario: Choice path returns rolled count and index

- **WHEN** `get_ideas` is called and `suggestedAnswersFormat` is `"choice"`
- **THEN** the response contains both `suggestedChoiceCount` (integer in `[min, max]`) and `suggestedCorrectIndex` (integer in `[0, suggestedChoiceCount)`)
- **AND** the response does NOT contain `suggestedAnswer`

#### Scenario: Boolean path omits choice fields

- **WHEN** `get_ideas` is called and `suggestedAnswersFormat` is `"boolean"`
- **THEN** the response contains `suggestedAnswer` (boolean)
- **AND** the response does NOT contain `suggestedChoiceCount` or `suggestedCorrectIndex`

#### Scenario: correctIndex distribution is uniform across runs

- **GIVEN** `min = 4` and `max = 4` (always 4 choices)
- **WHEN** `get_ideas` is called 1000 times with `suggestedAnswersFormat: "choice"`
- **THEN** the distribution of `suggestedCorrectIndex` across `{0, 1, 2, 3}` is uniform within statistical tolerance

### Requirement: save_question accepts choice-question shape

The `save_question` MCP tool SHALL accept the discriminated arguments for choice questions: `answersFormat: "choice"`, `choices: string[]` (length within the cascade-resolved `[min, max]` bounds for the question's coordinate), and `correctIndex: number` (an integer in `[0, choices.length)`). The tool SHALL validate:

- `answersFormat` MUST be `"choice"` for the choice path (and `"boolean"` for the boolean path; the field is now required on writes).
- `choices.length` MUST be ≥ resolved `min` and ≤ resolved `max`, where `min`/`max` come from `resolveCascade("choices", …)` evaluated at the saved question's slot/season/game/workspace coordinate (handed to the choice handler as a pre-resolved value, mirroring `resolvedJudgeLeniency`).
- `correctIndex` MUST be an integer in `[0, choices.length)`.
- `new Set(choices.map(c => c.trim().toLowerCase())).size === choices.length` — no duplicate or whitespace-equivalent choice strings.
- Each choice string MUST be 1–100 characters after trimming.
- The boolean-path arguments (`isTrue`) MUST NOT be set when `answersFormat: "choice"`.

On validation failure, the tool SHALL return a structured error indicating which constraint failed.

#### Scenario: Valid choice question saved

- **WHEN** `save_question` is called with `answersFormat: "choice"`, `choices: ["Mercury", "Venus", "Earth", "Mars"]`, `correctIndex: 0`, and a valid category/statement/emojis
- **THEN** the question is stored in `questions.json` with all six fields plus generated `id` and `createdAt`

#### Scenario: correctIndex out of range rejected

- **WHEN** `save_question` is called with `choices` of length 4 and `correctIndex: 4`
- **THEN** the tool returns a validation error indicating `correctIndex` must be in `[0, choices.length)`

#### Scenario: Duplicate choice strings rejected

- **WHEN** `save_question` is called with `choices: ["Paris", "London", "Paris", "Rome"]`
- **THEN** the tool returns a validation error indicating choices must be unique

#### Scenario: Whitespace-equivalent duplicate choices rejected

- **WHEN** `save_question` is called with `choices: ["Paris", "  PARIS  ", "London", "Rome"]`
- **THEN** the tool returns a validation error indicating choices must be unique (after trimming and case-folding)

#### Scenario: Choices out of resolved bounds rejected

- **GIVEN** the question's coordinate resolves to bounds `min: 2`, `max: 3`
- **WHEN** `save_question` is called with `choices` of length 4
- **THEN** the tool returns a validation error indicating choices length is outside the resolved `[min, max]`

#### Scenario: Choice question with isTrue rejected

- **WHEN** `save_question` is called with `answersFormat: "choice"`, valid `choices`/`correctIndex`, AND `isTrue: true`
- **THEN** the tool returns a validation error indicating `isTrue` is invalid for choice questions

### Requirement: Question-posting prompt branches on suggested answersFormat and questionType

The `send_questions_instructions` tool's returned prompt SHALL dispatch on a 2D matrix of `suggestedAnswersFormat` × `suggestedQuestionType` from `get_ideas`, producing four generation paths:

| | `suggestedAnswersFormat: "boolean"` | `suggestedAnswersFormat: "choice"` |
|---|---|---|
| `suggestedQuestionType: "fact"` | Fact + boolean path (existing boolean flow) | Fact + choice path (existing choice flow) |
| `suggestedQuestionType: "topical"` | Topical + boolean path (research via WebSearch, then existing boolean flow's gates) | Topical + choice path (research via WebSearch, then existing choice flow's gates) |

The two fact paths SHALL behave identically to the pre-topical `boolean` / `choice` flows described elsewhere in this spec. The two topical paths are specified in the `trivia-topical-questions` capability — they add a WebSearch-driven research step at the front but reuse the polarity/distractor/difficulty gates of their fact-path siblings unchanged.

When `suggestedAnswersFormat` is `"choice"`, the prompt SHALL (regardless of `suggestedQuestionType`) instruct Claude to:

1. Write the **correct answer first**, based on the topic chosen from `get_ideas` and the rolled `suggestedCorrectIndex`. The correct answer SHALL be the option that occupies the index named by `suggestedCorrectIndex`.
2. Write `suggestedChoiceCount − 1` plausible-but-wrong distractors, filling the remaining indices.
3. **Distractor plausibility gate (REQUIRED):** rate each option (correct + every distractor) 1–10 on "how plausible does this sound as the correct answer to someone who doesn't know the topic" (NOT "how true is it"). The gate has four conditions:
   - (a) correct answer plausibility ≥ 5
   - (b) highest distractor plausibility ≥ 4
   - (c) `correct − highest_distractor ≤ 4` (the gap is small)
   - (d) every distractor plausibility ≥ 2
   If any condition fails, the prompt SHALL instruct Claude to rewrite **only the failing distractor(s)**, never the correct answer. The retry budget is 3 distractor-rewrite passes; if the gate still fails, abandon the question and re-roll from `get_ideas`.
4. Run the existing difficulty gate against the question as a whole (target range from `suggestedDifficulty`).
5. Run the existing duplicate-check step against the statement (`find_previous_questions`).
6. Save via `save_question` with `answersFormat: "choice"`, the `choices` array, `correctIndex` set to `suggestedCorrectIndex`, the resolved `questionType`, and the same category/statement/emojis fields as the boolean path.
7. Format the post as a Block Kit card. The prompt SHALL offer two layouts and instruct Claude to pick by readability: **stacked** (one choice per line, `1️⃣ Option`) when any choice exceeds roughly 25 characters or the choices read more naturally on separate lines; **inline** (`1️⃣ A • 2️⃣ B • 3️⃣ C • 4️⃣ D`) otherwise.
8. Submit with `reactions` sized to `suggestedChoiceCount`: 2 → `["one", "two"]`, 3 → `["one", "two", "three"]`, 4 → `["one", "two", "three", "four"]`. Order matters — `:one:` first.

The prompt SHALL state explicitly that the correct answer's index is locked by `suggestedCorrectIndex` and that Claude MUST NOT rewrite the correct answer to fix a gate failure.

#### Scenario: Fact boolean path unchanged

- **WHEN** the question-posting prompt is invoked with `suggestedAnswersFormat: "boolean"` and `suggestedQuestionType: "fact"`
- **THEN** the prompt followed is the existing boolean flow (no WebSearch step) with `reactions: ["+1", "-1"]`

#### Scenario: Fact choice path writes correct answer first

- **WHEN** the question-posting prompt is invoked with `suggestedAnswersFormat: "choice"`, `suggestedQuestionType: "fact"`, and `suggestedCorrectIndex: 2`
- **THEN** the prompt instructs Claude to write the correct answer first and place it at index 2

#### Scenario: Topical boolean path adds WebSearch step

- **WHEN** the question-posting prompt is invoked with `suggestedAnswersFormat: "boolean"` and `suggestedQuestionType: "topical"`
- **THEN** the prompt requires Claude to invoke `WebSearch` before drafting the statement
- **AND** reuses the polarity gate, duplicate-check, difficulty gate, and emoji/save/post steps of the fact boolean path

#### Scenario: Topical choice path adds WebSearch step

- **WHEN** the question-posting prompt is invoked with `suggestedAnswersFormat: "choice"` and `suggestedQuestionType: "topical"`
- **THEN** the prompt requires Claude to invoke `WebSearch` before writing the correct answer
- **AND** reuses the distractor plausibility gate, duplicate-check, difficulty gate, and emoji/save/post steps of the fact choice path

#### Scenario: Distractor plausibility gate enforces all four conditions

- **WHEN** the question-posting prompt is invoked with `suggestedAnswersFormat: "choice"` (any `suggestedQuestionType`)
- **THEN** the prompt names all four conditions (correct ≥ 5, highest distractor ≥ 4, gap ≤ 4, every distractor ≥ 2)
- **AND** instructs Claude to rewrite only the failing distractor on gate failure, never the correct answer
- **AND** sets a retry budget of 3 distractor-rewrite passes

#### Scenario: Reactions array sized to choice count

- **WHEN** the question-posting prompt is invoked with `suggestedAnswersFormat: "choice"` and `suggestedChoiceCount: 3`
- **THEN** the prompt instructs Claude to call `submit_response` with `reactions: ["one", "two", "three"]` in that order

#### Scenario: Stacked vs inline layout guidance

- **WHEN** the question-posting prompt is invoked with `suggestedAnswersFormat: "choice"`
- **THEN** the prompt describes both stacked and inline Block Kit layouts
- **AND** instructs Claude to pick stacked when any choice is long, inline when all choices are short

### Requirement: Reveal flow resolves question before parsing reactions

The reveal flow (wholly inside `process_reveal_answers`) SHALL resolve the pending question record before assembling voter buckets. Scoring SHALL be derived from `answers.json` for all formats — Slack reactions SHALL NOT drive scoring on any answers-format value.

When `question.answersFormat` is `"boolean"`:
- Users with `SubmittedAnswer` rows where `answer === question.isTrue` land in `voters.correct`.
- Users with rows where `answer !== question.isTrue` land in `voters.incorrect`.
- The "fence-sitter" classification (voted both `:+1:` and `:-1:`) SHALL NOT exist — button click semantics make simultaneous opposite votes impossible.

When `question.answersFormat` is `"choice"`:
- Users with rows where `answerIndex === question.correctIndex` land in `voters.correct`.
- Users with rows where `answerIndex !== question.correctIndex` land in `voters.incorrect`.
- The "multi-react silently-voided" classification SHALL NOT exist — only one button click is the source of truth; subsequent clicks overwrite via `updateAnswer`.
- Persisted rows continue to carry `answerIndex: number` (no `answer: boolean`).

For all formats, the bot's user ID and every flagged cheater for the question SHALL be excluded from all `voters.*` buckets AND from the `voters.reactions` commentary list.

`question.questionType` (`"fact"` vs `"topical"`) SHALL NOT affect reveal behavior.

#### Scenario: Boolean reveal reads from answers.json

- **WHEN** the reveal flow processes a boolean question with `isTrue: true` and `answers.json` has `{ U1: true, U2: false }`
- **THEN** `voters.correct` contains U1, `voters.incorrect` contains U2
- **AND** the flow makes no reaction-based scoring decisions

#### Scenario: Choice reveal reads from answers.json

- **WHEN** the reveal flow processes a choice question with `correctIndex: 2` and `answers.json` has `{ U1: { answerIndex: 2 }, U2: { answerIndex: 0 } }`
- **THEN** `voters.correct` contains U1, `voters.incorrect` contains U2

#### Scenario: No fence-sitters category in payload

- **WHEN** any reveal payload is returned
- **THEN** the `voters` object SHALL NOT have a `fenceSitters` field

#### Scenario: No multi-react void in payload

- **WHEN** the reveal flow processes a choice question and any user added multiple numbered emoji as reactions
- **THEN** the user's button click (if any) determines their bucket placement; reactions do not void anything
- **AND** the payload shape contains no field that names or counts multi-react voters

#### Scenario: questionType does not alter reveal

- **WHEN** the reveal flow processes a question with `questionType: "topical"`
- **THEN** the flow behaves identically to a `questionType: "fact"` question of the same `answersFormat`

### Requirement: Bot auto-reactions sized to answersFormat

The bot SHALL NOT auto-attach reactions to questions of ANY answers format. `post_questions` SHALL append answer-buttons via an `actions` block instead (see `trivia-question-posting`).

Users may freely add their own reactions to question messages. Those reactions are read at reveal time purely as commentary (see `trivia-reveal-processor`'s `voters.reactions` field) — they SHALL NOT drive scoring.

#### Scenario: No auto-attached reactions on boolean

- **WHEN** the bot posts a question with `answersFormat: "boolean"`
- **THEN** zero reactions are auto-attached to the message
- **AND** the message includes an `actions` block with `👍 TRUE` and `👎 FALSE` buttons

#### Scenario: No auto-attached reactions on choice

- **WHEN** the bot posts a question with `answersFormat: "choice"` of any choice count
- **THEN** zero reactions are auto-attached
- **AND** the message includes an `actions` block with one button per choice

#### Scenario: No auto-attached reactions on freeform

- **WHEN** the bot posts a question with `answersFormat: "freeform"`
- **THEN** zero reactions are auto-attached
- **AND** the message includes an `actions` block with an "Answer" button

#### Scenario: User-added reactions are preserved as commentary

- **GIVEN** a posted question and user U1 reacts with `:fire:`
- **WHEN** `process_reveal_answers` runs
- **THEN** `voters.reactions` contains `{ userId: "U1", emojis: ["fire"] }`

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

### Requirement: Choice option-count bounds cascade through all tiers

The `choices: { min, max }` option-count bounds SHALL be a first-wins cascade axis resolved through `resolveCascade("choices", ctx)`, following the standard order `slot → season → game → workspace → built-in default` with whole-object replace per tier (no field-level merge across tiers). The built-in default is `DEFAULT_TRIVIA_CHOICES` (`{ min: 4, max: 4 }`). Both consumers — the `get_ideas` choice-count roll and the `save_question` length validation — SHALL resolve bounds through this single path for the same coordinate, so a count the roll produces always passes save validation. The bounds SHALL NOT be stamped on the `TriviaQuestion` record (the stored `choices` array already encodes the resolved count).

#### Scenario: Game override wins over workspace

- **GIVEN** `config.trivia.choices` is `{ min: 4, max: 4 }` and a game carries `choices: { min: 2, max: 2 }`
- **WHEN** `get_ideas` rolls a choice question for that game (no season active, no slot override)
- **THEN** `suggestedChoiceCount` is `2`

#### Scenario: Per-slot pacing via game format

- **GIVEN** a game's `format.questions` is `[{ choices: { min: 2, max: 2 } }, { choices: { min: 4, max: 4 } }]` and no active season
- **WHEN** `get_ideas` rolls a choice question for `slot: 0`, then for `slot: 1`
- **THEN** slot 0 yields `suggestedChoiceCount: 2` and slot 1 yields `suggestedChoiceCount: 4`

#### Scenario: Season override wins over game

- **GIVEN** seasons are enabled, the active season carries `choices: { min: 3, max: 3 }`, and the game carries `choices: { min: 2, max: 2 }`
- **WHEN** `get_ideas` rolls a choice question (no per-slot override)
- **THEN** `suggestedChoiceCount` is `3`

#### Scenario: Absent at every tier falls back to default

- **GIVEN** no `choices` value is set at the slot, season, game, or workspace tier
- **WHEN** `get_ideas` rolls a choice question
- **THEN** the bounds are `DEFAULT_TRIVIA_CHOICES` (`{ min: 4, max: 4 }`) and `suggestedChoiceCount` is `4`

#### Scenario: Roll and save agree on bounds

- **GIVEN** a coordinate resolves to bounds `{ min: 2, max: 2 }`
- **WHEN** `get_ideas` rolls `suggestedChoiceCount: 2` for that coordinate and `save_question` is called with `choices` of length 2 for the same coordinate
- **THEN** `save_question` accepts the question (no bounds error), because both used `resolveCascade("choices", …)`

#### Scenario: explain_cascade reports the choices ladder

- **WHEN** a `member`+ user calls `explain_cascade({ game: "x", slot: 0 })`
- **THEN** the `choices` axis appears in the result with its resolved `value`, winning `tier`, and per-tier `ladder`
