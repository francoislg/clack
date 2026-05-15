# trivia-choice-questions

## Purpose

Add support for multiple-choice trivia questions alongside the existing boolean (true/false) questions. Supports per-season and global configuration of question-type weights, server-rolled choice metadata, and tailored reveal flows with proper voter categorization and multi-react voiding.

## Requirements

### Requirement: Question type discriminator

The system SHALL support two question types: `boolean` (existing true/false questions) and `choice` (new multiple-choice questions). A `TriviaQuestion` record SHALL carry an optional `type: "boolean" | "choice"` field. When `type` is absent on a stored record, the system SHALL treat the record as `type: "boolean"`. When `type: "choice"`, the record SHALL carry `choices: string[]` (length 2–4) and `correctIndex: number` (0-based) and SHALL NOT carry `isTrue`. When `type: "boolean"`, the record SHALL carry `isTrue: boolean` and SHALL NOT carry `choices` or `correctIndex`.

#### Scenario: Legacy boolean record without type field

- **GIVEN** a `TriviaQuestion` record in `questions.json` with `isTrue: true` and no `type` field
- **WHEN** any tool reads the record
- **THEN** the system treats it as a boolean question equivalent to `{ type: "boolean", isTrue: true, ... }`

#### Scenario: New boolean record carries type

- **WHEN** `save_question` saves a boolean question via this change
- **THEN** the stored record has `type: "boolean"` and `isTrue` set, and lacks `choices` and `correctIndex`

#### Scenario: New choice record carries discriminated fields

- **WHEN** `save_question` saves a choice question with 4 choices and `correctIndex: 2`
- **THEN** the stored record has `type: "choice"`, `choices` of length 4, and `correctIndex: 2`, and lacks `isTrue`

### Requirement: Choice-question configuration

The system SHALL accept an optional `trivia.questionsTypes` configuration block — a map from question-type name (`"boolean"` or `"choice"`) to a non-negative integer weight — and an optional `trivia.choices` configuration block with numeric `min` and `max` fields (defaults: `min: 2`, `max: 4`; both must satisfy `2 ≤ min ≤ max ≤ 4`). When `trivia.questionsTypes` is absent or contains only the `"boolean"` key, the system SHALL behave identically to deployments without this change (no choice questions are generated).

#### Scenario: Default configuration generates boolean questions only

- **GIVEN** `data/config.json` has no `trivia.questionsTypes` field
- **WHEN** `get_ideas` is called
- **THEN** the returned `suggestedType` is always `"boolean"`

#### Scenario: Mixed-type configuration generates both types

- **GIVEN** `data/config.json` has `trivia.questionsTypes: { "boolean": 2, "choice": 1 }`
- **WHEN** `get_ideas` is called many times
- **THEN** approximately 2/3 of calls return `suggestedType: "boolean"` and approximately 1/3 return `suggestedType: "choice"` (within statistical tolerance)

#### Scenario: Choice-only configuration

- **GIVEN** `data/config.json` has `trivia.questionsTypes: { "choice": 1 }`
- **WHEN** `get_ideas` is called
- **THEN** the returned `suggestedType` is always `"choice"`

#### Scenario: Invalid choice bounds rejected at load

- **GIVEN** `data/config.json` has `trivia.choices: { min: 5, max: 10 }`
- **WHEN** the config is loaded
- **THEN** the system rejects the config with a validation error indicating bounds must satisfy `2 ≤ min ≤ max ≤ 4`

### Requirement: questionTypes is per-season, with config fallback

`questionsTypes` resolution at `get_ideas` time SHALL follow this priority:

1. If the seasons feature is enabled AND `findCurrentSeason(state, Date.now())` returns a non-null `SeasonEntry` whose `questionTypes` field is set, use that entry's `questionTypes`.
2. Otherwise (seasons disabled, `now` falls in a timeline gap, or the current entry has no `questionTypes` field), use `config.trivia.questionsTypes`.
3. Otherwise (both absent), default to `{ "boolean": 1 }` (pure-boolean, equivalent to pre-change behavior).

The system SHALL re-read these sources on every `get_ideas` call — no caching, no pre-computation. The `choices.{min, max}` setting SHALL NOT be season-overridable — it lives only at `config.trivia.choices` with defaults `{ min: 2, max: 4 }`.

#### Scenario: Current season's questionTypes overrides config

- **GIVEN** seasons are enabled and `findCurrentSeason(state, now)` returns an entry with `questionTypes: { "choice": 1 }`
- **AND** `config.trivia.questionsTypes` is `{ "boolean": 1 }`
- **WHEN** `get_ideas` is called
- **THEN** the returned `suggestedType` is always `"choice"`

#### Scenario: Current season without questionTypes falls back to config

- **GIVEN** seasons are enabled and the current `SeasonEntry` has no `questionTypes` field
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

- **GIVEN** seasons are enabled with no current entry questionTypes set, AND `config.trivia.questionsTypes` is absent
- **WHEN** `get_ideas` is called
- **THEN** the returned `suggestedType` is always `"boolean"`

#### Scenario: Mid-season update via upsert_season takes effect on next call

- **GIVEN** `get_ideas` was called once with the current entry's previous `questionTypes`
- **WHEN** `upsert_season(currentSlug, { questionTypes: { "choice": 1 } })` is called and `get_ideas` is called again
- **THEN** the second call uses the updated weights

#### Scenario: choices.min/max is not per-season

- **GIVEN** `config.trivia.choices` is `{ min: 2, max: 4 }`
- **WHEN** `get_ideas` reads the choice bounds (for a choice-typed roll)
- **THEN** the bounds come from `config.trivia.choices` regardless of whether a current season exists or what fields it carries

### Requirement: Server-rolled choice metadata in get_ideas

When `suggestedType` resolves to `"choice"`, `get_ideas` SHALL additionally return:

- `suggestedChoiceCount`: a uniform random integer in `[min, max]` (where `min` and `max` come from the active `trivia.choices` source).
- `suggestedCorrectIndex`: a uniform random integer in `[0, suggestedChoiceCount)`.

When `suggestedType` resolves to `"boolean"`, the boolean-path `suggestedAnswer` SHALL continue to be returned as before, and `suggestedChoiceCount` and `suggestedCorrectIndex` SHALL NOT be returned.

#### Scenario: Choice path returns rolled count and index

- **WHEN** `get_ideas` is called and `suggestedType` is `"choice"`
- **THEN** the response contains both `suggestedChoiceCount` (integer in `[min, max]`) and `suggestedCorrectIndex` (integer in `[0, suggestedChoiceCount)`)
- **AND** the response does NOT contain `suggestedAnswer`

#### Scenario: Boolean path omits choice fields

- **WHEN** `get_ideas` is called and `suggestedType` is `"boolean"`
- **THEN** the response contains `suggestedAnswer` (boolean)
- **AND** the response does NOT contain `suggestedChoiceCount` or `suggestedCorrectIndex`

#### Scenario: correctIndex distribution is uniform across runs

- **GIVEN** `min = 4` and `max = 4` (always 4 choices)
- **WHEN** `get_ideas` is called 1000 times with `suggestedType: "choice"`
- **THEN** the distribution of `suggestedCorrectIndex` across `{0, 1, 2, 3}` is uniform within statistical tolerance

### Requirement: save_question accepts choice-question shape

The `save_question` MCP tool SHALL accept the discriminated arguments for choice questions: `type: "choice"`, `choices: string[]` (length within the active `[min, max]` bounds), and `correctIndex: number` (an integer in `[0, choices.length)`). The tool SHALL validate:

- `type` MUST be `"choice"` for the choice path (and `"boolean"` or absent for the boolean path).
- `choices.length` MUST be ≥ active `min` and ≤ active `max`.
- `correctIndex` MUST be an integer in `[0, choices.length)`.
- `new Set(choices.map(c => c.trim().toLowerCase())).size === choices.length` — no duplicate or whitespace-equivalent choice strings.
- Each choice string MUST be 1–100 characters after trimming.
- The boolean-path arguments (`isTrue`) MUST NOT be set when `type: "choice"`.

On validation failure, the tool SHALL return a structured error indicating which constraint failed.

#### Scenario: Valid choice question saved

- **WHEN** `save_question` is called with `type: "choice"`, `choices: ["Mercury", "Venus", "Earth", "Mars"]`, `correctIndex: 0`, and a valid category/statement/emojis
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

#### Scenario: Choices out of configured bounds rejected

- **GIVEN** active `min: 2`, `max: 4`
- **WHEN** `save_question` is called with `choices` of length 5
- **THEN** the tool returns a validation error indicating choices length is outside `[min, max]`

#### Scenario: Choice question with isTrue rejected

- **WHEN** `save_question` is called with `type: "choice"`, valid `choices`/`correctIndex`, AND `isTrue: true`
- **THEN** the tool returns a validation error indicating `isTrue` is invalid for choice questions

### Requirement: Question-posting prompt branches on suggested type

The `send_questions_instructions` tool's returned prompt SHALL branch on `suggestedType` from `get_ideas`:

- When `suggestedType` is `"boolean"`, the prompt SHALL follow the existing boolean flow (research → polarity gate → duplicate check → validate → difficulty gate → emoji → save → format with 👍/👎 → submit with `reactions: ["+1", "-1"]`).
- When `suggestedType` is `"choice"`, the prompt SHALL instruct Claude to:
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
  6. Save via `save_question` with `type: "choice"`, the `choices` array, `correctIndex` set to `suggestedCorrectIndex`, and the same category/statement/emojis fields as the boolean path.
  7. Format the post as a Block Kit card. The prompt SHALL offer two layouts and instruct Claude to pick by readability: **stacked** (one choice per line, `1️⃣ Option`) when any choice exceeds roughly 25 characters or the choices read more naturally on separate lines; **inline** (`1️⃣ A • 2️⃣ B • 3️⃣ C • 4️⃣ D`) otherwise.
  8. Submit with `reactions` sized to `suggestedChoiceCount`: 2 → `["one", "two"]`, 3 → `["one", "two", "three"]`, 4 → `["one", "two", "three", "four"]`. Order matters — `:one:` first.

The prompt SHALL state explicitly that the correct answer's index is locked by `suggestedCorrectIndex` and that Claude MUST NOT rewrite the correct answer to fix a gate failure (because that defeats the server-rolled correctness position).

#### Scenario: Boolean path unchanged

- **WHEN** the question-posting prompt is invoked and `suggestedType` is `"boolean"`
- **THEN** the prompt followed is the existing 10-step boolean flow with `reactions: ["+1", "-1"]`

#### Scenario: Choice path writes correct answer first

- **WHEN** the question-posting prompt is invoked and `suggestedType` is `"choice"` with `suggestedCorrectIndex: 2`
- **THEN** the prompt instructs Claude to write the correct answer first and place it at index 2

#### Scenario: Distractor plausibility gate enforces all four conditions

- **WHEN** the question-posting prompt is invoked and `suggestedType` is `"choice"`
- **THEN** the prompt names all four conditions (correct ≥ 5, highest distractor ≥ 4, gap ≤ 4, every distractor ≥ 2)
- **AND** instructs Claude to rewrite only the failing distractor on gate failure, never the correct answer
- **AND** sets a retry budget of 3 distractor-rewrite passes

#### Scenario: Reactions array sized to choice count

- **WHEN** the question-posting prompt is invoked and `suggestedType` is `"choice"` with `suggestedChoiceCount: 3`
- **THEN** the prompt instructs Claude to call `submit_response` with `reactions: ["one", "two", "three"]` in that order

#### Scenario: Stacked vs inline layout guidance

- **WHEN** the question-posting prompt is invoked and `suggestedType` is `"choice"`
- **THEN** the prompt describes both stacked and inline Block Kit layouts
- **AND** instructs Claude to pick stacked when any choice is long, inline when all choices are short

### Requirement: Reveal flow resolves question before parsing reactions

The `process_responses_instructions` tool's returned prompt SHALL re-order the existing reveal flow so the question is resolved via `find_previous_questions` (and `get_question_history` is called for `cheaterUserIds`) **before** any reaction parsing or voter categorization. The prompt SHALL instruct Claude to read `question.type` (defaulting to `"boolean"` when absent on the stored record) and branch all subsequent reaction parsing and voter categorization on this value.

When `question.type` is `"boolean"`, the reaction-parsing behavior SHALL be unchanged from the pre-existing boolean reveal (`:+1:` = TRUE, `:-1:` = FALSE, fence-sitters reacted with both, wildcards reacted with other emojis, bot and cheater IDs excluded silently).

When `question.type` is `"choice"`:

- `:one:`, `:two:`, `:three:`, `:four:` reactions map to choice indices 0, 1, 2, 3 respectively.
- Correct voters SHALL be users who reacted with exactly the numbered emoji corresponding to `question.correctIndex` (after bot and cheater exclusion).
- Incorrect voters SHALL be users who reacted with exactly one wrong numbered emoji (after bot and cheater exclusion).
- **Multi-react voters** (users who reacted with 2 or more numbered emoji) SHALL be **silently voided** — not scored, not included in the `submit_answers` payload, not surfaced in the user-facing reveal (no callout, no playful roast).
- **Wildcards** (users who reacted only with non-numbered emojis) SHALL continue to be read aloud with the Game Show Presenter persona's interpretive humor (consistent with the existing boolean wildcards behavior).
- `submit_answers` SHALL be called with `answerIndex: number` per entry (the reaction's numbered index), `userId`, and `displayName` — `answer: boolean` is omitted on the choice path.

#### Scenario: Boolean reveal unchanged

- **WHEN** the reveal prompt is invoked and the resolved question has `type: "boolean"` (or absent)
- **THEN** the prompt directs Claude to parse `:+1:` / `:-1:` reactions, categorize fence-sitters, and submit `answer: boolean` per voter

#### Scenario: Choice reveal parses numbered reactions

- **WHEN** the reveal prompt is invoked and the resolved question has `type: "choice"` with `correctIndex: 2`
- **THEN** the prompt directs Claude to parse `:one:` / `:two:` / `:three:` / `:four:` reactions, treat `:three:` (index 2) reactors as correct voters, and submit `answerIndex: number` per voter

#### Scenario: Multi-react voters on choice questions silently voided

- **WHEN** a user reacted with both `:one:` and `:three:` on a choice question
- **THEN** the reveal prompt directs Claude to exclude that user from both correct and incorrect categories
- **AND** to omit that user from the `submit_answers` payload
- **AND** to NOT mention that user in the user-facing reveal copy

#### Scenario: Wildcards on choice questions still surfaced

- **WHEN** a user reacted with `:shrug:` on a choice question
- **THEN** the reveal prompt directs Claude to read the wildcard aloud with persona humor, same as on boolean questions

### Requirement: Choice-question reveal hard-fails on unresolvable question

When the reveal flow is run and the resolved question is `type: "choice"` but the question cannot be located (e.g., `find_previous_questions` returns no match for any keyword refinement), the prompt SHALL instruct Claude to **post an admin-facing error** in the channel (a short message indicating the reveal cannot proceed because the question's correctIndex is unknown), rather than guessing a `correctIndex` or proceeding with a best-effort fallback.

When the question is `type: "boolean"` (or absent → boolean), the existing best-effort fallback behavior SHALL be preserved (boolean reveal can derive correctness from the statement-truth research alone).

#### Scenario: Choice reveal posts admin error on unresolvable question

- **WHEN** the channel's most-recent trivia message corresponds to a choice question but `find_previous_questions` returns no match after refinement
- **THEN** the reveal prompt directs Claude to post a short admin-facing error in the channel and abort the reveal
- **AND** does NOT direct Claude to guess `correctIndex` or proceed with `submit_answers`

#### Scenario: Boolean reveal preserves best-effort fallback

- **WHEN** the channel's most-recent trivia message corresponds to a boolean question and `find_previous_questions` returns no match
- **THEN** the reveal prompt directs Claude to proceed with a best-effort `questionId` based on the most recently `createdAt` matching question (existing behavior)

### Requirement: Bot auto-reactions sized to question type

When the bot posts a question via `submit_response` with a `reactions` array, the array SHALL be sized to the question's branching factor:

- Boolean question: `["+1", "-1"]` in that order (👍 before 👎).
- Choice question with N choices (2 ≤ N ≤ 4): the first N entries of `["one", "two", "three", "four"]`, in that order.

#### Scenario: Boolean post auto-reactions

- **WHEN** the bot posts a boolean trivia question
- **THEN** the `reactions` array passed to `submit_response` is exactly `["+1", "-1"]`

#### Scenario: 4-choice post auto-reactions

- **WHEN** the bot posts a 4-choice trivia question
- **THEN** the `reactions` array passed to `submit_response` is exactly `["one", "two", "three", "four"]`

#### Scenario: 3-choice post auto-reactions

- **WHEN** the bot posts a 3-choice trivia question
- **THEN** the `reactions` array passed to `submit_response` is exactly `["one", "two", "three"]`

#### Scenario: 2-choice post auto-reactions

- **WHEN** the bot posts a 2-choice trivia question
- **THEN** the `reactions` array passed to `submit_response` is exactly `["one", "two"]`
