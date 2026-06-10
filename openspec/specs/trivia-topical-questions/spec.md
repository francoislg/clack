# trivia-topical-questions

## Purpose

Adds a `questionType: "fact" | "topical"` axis orthogonal to `answersFormat`. Topical questions force Claude to use the built-in `WebSearch` tool to find a recent newsworthy event before drafting the question, and persist a mandatory `sourceUrl` (plus optional `eventDate`) on the stored record. Fact questions are pre-topical static-knowledge questions, unchanged. Default `{ fact: 1, topical: 0 }` means a deployment is unaffected until an admin opts in.

## Requirements

### Requirement: questionType axis on question records and configuration

The system SHALL persist `questionType: "fact" | "topical"` on every newly-written `TriviaQuestion` record. When a stored record carries no `questionType` field, the system SHALL read it as `"fact"`. The system SHALL accept a `questionType` weight map of the same shape as `answersFormat` (a map from `"fact"`/`"topical"` to non-negative integer weights) at three cascade tiers: `config.trivia.questionType`, `SeasonEntry.questionType`, and `SeasonFormatSlot.questionType`. Resolution priority on each `get_ideas` call SHALL be:

1. Slot's `questionType` (when the active season has a `format` and the resolved slot has the field).
2. Season's `questionType` (when set on the current `SeasonEntry`).
3. `config.trivia.questionType`.
4. Default `{ fact: 1, topical: 0 }` — equivalent to pre-change behavior.

The system SHALL re-read these sources on every `get_ideas` call (no caching). The system SHALL reject configurations whose `questionType` maps have all-zero weights or contain keys other than `"fact"` and `"topical"`.

#### Scenario: Legacy record without questionType reads as fact

- **GIVEN** a stored `TriviaQuestion` record with `answersFormat: "boolean"` and no `questionType` field
- **WHEN** any code path reads the record
- **THEN** the system treats it as `questionType: "fact"`

#### Scenario: New record carries questionType

- **WHEN** `save_question` writes any new question
- **THEN** the stored record has a `questionType` of either `"fact"` or `"topical"`

#### Scenario: Default configuration generates fact-only questions

- **GIVEN** no `questionType` weights are set at any cascade tier
- **WHEN** `get_ideas` is called repeatedly
- **THEN** `suggestedQuestionType` is always `"fact"`

#### Scenario: Mixed configuration generates both types

- **GIVEN** `config.trivia.questionType` is `{ fact: 3, topical: 1 }` and no season/slot override
- **WHEN** `get_ideas` is called many times
- **THEN** approximately 3/4 of calls return `suggestedQuestionType: "fact"` and 1/4 return `"topical"` (within statistical tolerance)

#### Scenario: Slot questionType overrides season

- **GIVEN** the active season has `questionType: { fact: 1, topical: 1 }` and `format.questions[0].questionType: { topical: 1 }`
- **WHEN** `get_ideas` is called with `slot: 0`
- **THEN** `suggestedQuestionType` is always `"topical"`

#### Scenario: Season questionType overrides config

- **GIVEN** the active season has `questionType: { topical: 1 }` and `config.trivia.questionType` is `{ fact: 1 }`
- **WHEN** `get_ideas` is called
- **THEN** `suggestedQuestionType` is always `"topical"`

#### Scenario: All-zero weights rejected at load

- **GIVEN** `config.trivia.questionType` is `{ fact: 0, topical: 0 }`
- **WHEN** the config is loaded
- **THEN** the system rejects the config with a validation error

#### Scenario: Unknown keys rejected at load

- **GIVEN** `config.trivia.questionType` is `{ fact: 1, news: 1 }`
- **WHEN** the config is loaded
- **THEN** the system rejects the config with a validation error indicating only `fact` and `topical` are permitted keys

### Requirement: suggestedQuestionType in get_ideas response

When `get_ideas` is invoked, the system SHALL roll `suggestedQuestionType` independently from `suggestedAnswersFormat` using the active `questionType` weights, and SHALL return it in the response. Both rolls are independent — there is no joint distribution.

#### Scenario: suggestedQuestionType always present in response

- **WHEN** `get_ideas` is called
- **THEN** the response includes `suggestedQuestionType` of either `"fact"` or `"topical"`

#### Scenario: Independent rolls compose multiplicatively

- **GIVEN** `answersFormat: { boolean: 1, choice: 1 }` and `questionType: { fact: 1, topical: 1 }`
- **WHEN** `get_ideas` is called many times
- **THEN** each of the four combinations `(boolean, fact)`, `(boolean, topical)`, `(choice, fact)`, `(choice, topical)` appears approximately 25% of the time

### Requirement: Topical question record carries source citation

When a `TriviaQuestion` record has `questionType: "topical"`, the record SHALL carry `sourceUrl: string` (a citation URL Claude surfaced during WebSearch) and MAY carry `eventDate: string` (ISO 8601 date of the underlying event). When `questionType` is `"fact"` (or absent), the record SHALL NOT carry `sourceUrl` or `eventDate`.

#### Scenario: Topical record stores sourceUrl

- **WHEN** `save_question` writes a question with `questionType: "topical"` and `sourceUrl: "https://example.com/article"`
- **THEN** the stored record has `sourceUrl: "https://example.com/article"`

#### Scenario: Topical record optionally stores eventDate

- **WHEN** `save_question` writes a topical question with `eventDate: "2026-05-19"`
- **THEN** the stored record has `eventDate: "2026-05-19"`

#### Scenario: Topical record without eventDate is permitted

- **WHEN** `save_question` writes a topical question without `eventDate`
- **THEN** the stored record has no `eventDate` field

### Requirement: save_question validates topical fields

The `save_question` MCP tool SHALL apply the following validation rules for topical questions:

- When `questionType: "topical"`, `sourceUrl` MUST be present and MUST match a basic URL shape (begins with `https://` and contains a host).
- When `questionType: "fact"` (or absent), `sourceUrl` MUST NOT be present.
- When `eventDate` is present, it MUST be a valid ISO 8601 calendar date (`YYYY-MM-DD`).
- When `eventDate` is present, `questionType` MUST be `"topical"`.

On any validation failure, the tool SHALL return a structured error indicating which constraint failed.

#### Scenario: Topical without sourceUrl rejected

- **WHEN** `save_question` is called with `questionType: "topical"` and no `sourceUrl`
- **THEN** the tool returns a validation error indicating `sourceUrl` is required for topical questions

#### Scenario: Fact with sourceUrl rejected

- **WHEN** `save_question` is called with `questionType: "fact"` and `sourceUrl: "https://example.com"`
- **THEN** the tool returns a validation error indicating `sourceUrl` is not permitted for fact questions

#### Scenario: Non-HTTPS sourceUrl rejected

- **WHEN** `save_question` is called with `questionType: "topical"` and `sourceUrl: "http://example.com"`
- **THEN** the tool returns a validation error indicating `sourceUrl` must use `https://`

#### Scenario: Malformed eventDate rejected

- **WHEN** `save_question` is called with `questionType: "topical"`, valid `sourceUrl`, and `eventDate: "May 19, 2026"`
- **THEN** the tool returns a validation error indicating `eventDate` must be ISO 8601 (`YYYY-MM-DD`)

#### Scenario: eventDate without topical rejected

- **WHEN** `save_question` is called with `questionType: "fact"` and `eventDate: "2026-05-19"`
- **THEN** the tool returns a validation error indicating `eventDate` is only permitted on topical questions

#### Scenario: Valid topical question saved

- **WHEN** `save_question` is called with `questionType: "topical"`, `answersFormat: "choice"`, valid choices/correctIndex, `sourceUrl: "https://example.com/article"`, and `eventDate: "2026-05-19"`
- **THEN** the question is stored with all fields present

### Requirement: Topical generation path uses WebSearch

The scheduled question-posting prompt SHALL include a topical generation path that activates when `suggestedQuestionType` is `"topical"`. The path SHALL instruct Claude to:

1. Invoke `WebSearch` with a query composed from the chosen category and (if applicable) the current context.
2. Identify a newsworthy event that clears a **salience bar**: an event the general audience (the workspace's members) would recognize as genuinely newsworthy and interesting — trending, breaking, or widely-reported — rather than a niche item known only to specialists, so that a knowledgeable player has a reasoning foothold instead of facing an obscure datum. The path SHALL instruct Claude to prefer **salience over recency**: a genuinely significant event from the past week SHALL be chosen over a trivial one from the last day or two.
3. Write a question (per `suggestedAnswersFormat`) anchored on the chosen event.
4. When constructing a FALSE boolean topical statement, derive the falsity by swapping exactly ONE element of the event's **substance** — the person, the place, what-happened, or the consequence — and SHALL NOT make the statement false by swapping a date or a raw number. The "Current News" frame already asserts recency and the statement carries no date stamp, so a date/number swap both contradicts the frame and degrades the question into a recall-only test rather than a reasoning one.
5. Capture the source URL (the most authoritative result that supports the claim) and pass it to `save_question` as `sourceUrl`.
6. Optionally capture the event date and pass it as `eventDate`.
7. Apply the same downstream gates as the fact paths (polarity self-check for boolean; distractor plausibility for choice; difficulty self-rating; the shared PUZZLE QUALITY GATE before save).

When WebSearch returns no usable result for the chosen lens, Claude SHALL descend the context priority list per `trivia-question-contexts`. When no lens yields an event that clears the salience bar, Claude SHALL fall back to the fact path for the same `answersFormat` (preferred, since it keeps the slot productive) or, if that is unsuitable, re-call `get_ideas` to re-roll; forcing an obscure event is prohibited.

#### Scenario: Topical path invokes WebSearch

- **GIVEN** `suggestedQuestionType: "topical"`
- **WHEN** the prompt branches into the topical path
- **THEN** the prompt requires Claude to call `WebSearch` before drafting the question

#### Scenario: Topical path captures sourceUrl

- **GIVEN** Claude has chosen a newsworthy event from WebSearch results
- **WHEN** the prompt instructs the `save_question` call
- **THEN** the prompt requires passing the source URL as `sourceUrl`

#### Scenario: Topical path prefers salience over recency

- **WHEN** the topical event-selection step is inspected
- **THEN** the prompt instructs Claude to choose an event the general audience would recognize as newsworthy and interesting, not a niche item
- **AND** instructs Claude to prefer a genuinely significant event over a more recent but trivial one (e.g. a widely-reported development from a week ago over a minor report from this morning)

#### Scenario: Topical boolean falsity swaps substance, not date

- **WHEN** the topical boolean false-statement guidance is inspected
- **THEN** the prompt instructs Claude to make a false topical boolean statement by swapping one element of the event's substance (person, place, what-happened, consequence)
- **AND** the prompt does NOT instruct Claude to make a topical boolean statement false by swapping a date or a raw number
- **AND** the prompt explains that a date/number swap contradicts the "Current News" recency frame and degrades the question into a recall-only test

#### Scenario: Topical path falls back when no salient event found

- **GIVEN** no event clears the salience bar across the context priority list
- **WHEN** Claude has exhausted the lenses
- **THEN** the prompt instructs Claude to fall back to the fact path for the same `answersFormat` as the preferred option, or re-call `get_ideas` if the fact path is unsuitable

### Requirement: post_questions and reveal flows are agnostic to questionType

The `post_questions` MCP tool, the bot's auto-reaction shape, and the `process_reveal_answers` flow SHALL behave identically regardless of `questionType`. Card shape, reaction set, and reveal layout are determined by `answersFormat` alone.

#### Scenario: Topical boolean question posts identical card to fact boolean

- **GIVEN** a question with `questionType: "topical"` and `answersFormat: "boolean"`
- **WHEN** `post_questions` posts the question card
- **THEN** the card shape (block layout, reactions attached) is identical to a `questionType: "fact"` boolean question

#### Scenario: Topical choice reveal renders identically to fact choice

- **GIVEN** a topical choice question
- **WHEN** `process_reveal_answers` produces the reveal payload
- **THEN** the reveal block layout is identical to a fact choice reveal of the same shape
