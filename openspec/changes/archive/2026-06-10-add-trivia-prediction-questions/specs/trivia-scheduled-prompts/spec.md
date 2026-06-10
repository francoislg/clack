## ADDED Requirements

### Requirement: Question-posting prompt has a prediction generation path

When a slot resolves `questionType: "prediction"`, the question-posting prompt SHALL drive a PREDICTION MODIFIER on top of the answer-shape path body: Claude uses `WebSearch` to find an UPCOMING event whose outcome resolves before the reveal and is objectively checkable, captures a `sourceUrl`, drafts a `boolean` / `choice` / `freeform` question about that future outcome, and saves it via `save_question` WITHOUT an answer key (no `isTrue` / `correctIndex` / `expectedAnswer`). The answer-key gates (polarity self-check, distractor plausibility) are skipped; the difficulty and duplicate gates still apply. This path is additive — the fact/topical paths are unchanged.

#### Scenario: prediction path researches an upcoming event and saves no key

- **WHEN** the question prompt runs for a slot that resolved `questionType: "prediction"`
- **THEN** Claude WebSearches an upcoming event, drafts a question about its future outcome
- **AND** calls `save_question` with `questionType: "prediction"`, a `sourceUrl`, and no answer key

#### Scenario: fact/topical paths unchanged

- **WHEN** the question prompt runs for a `fact` or `topical` slot
- **THEN** generation behaves exactly as before this change (the prediction path is not entered)

### Requirement: Answer-reveal prompt settles or invalidates predictions before scoring

The answer-reveal prompt SHALL include a leading SETTLE step: when `compute_answers` reports `UNDECIDED_PREDICTIONS`, for each listed prediction Claude uses `WebSearch` to find the result and either calls `settle_question({ outcome })` (result known) or `settle_question({ invalidate: true, invalidatedReason })` (postponed / unresolvable), then re-calls `compute_answers`. The reveal `requiredTools` SHALL include `settle_question`.

#### Scenario: result found → answer

- **WHEN** a prediction's event has concluded with a known result
- **THEN** Claude calls `settle_question` with the `outcome`, then re-runs `compute_answers`, which scores it

#### Scenario: result unavailable → invalidate

- **WHEN** a prediction's event is postponed or its result is unresolvable
- **THEN** Claude calls `settle_question` with `invalidate: true` + a reason, and the question is reported in `invalidatedQuestions` (worth 0)

### Requirement: Reveal prompt renders invalidated questions

The answer-reveal prompt SHALL mention each entry in the payload's `invalidatedQuestions` as an "invalidated — <reason>" note (worth 0, no result). Resolved questions in the same fire render exactly as today.

#### Scenario: invalidated question is mentioned in the reveal

- **WHEN** a reveal fire's payload contains `invalidatedQuestions`
- **THEN** the reveal post notes each as invalidated with its reason, and does not present a result for it
