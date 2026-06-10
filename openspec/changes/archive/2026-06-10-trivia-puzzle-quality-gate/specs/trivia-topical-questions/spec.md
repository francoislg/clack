## MODIFIED Requirements

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
