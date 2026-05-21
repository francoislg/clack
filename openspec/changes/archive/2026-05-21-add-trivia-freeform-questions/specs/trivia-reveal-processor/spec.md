## ADDED Requirements

### Requirement: Freeform Reveal Invokes Inline Batch Judge

`process_reveal_answers` SHALL detect any freeform questions in the batch it is about to process. For each freeform question with at least one pending `SubmittedAnswer` row (`correct === undefined`), the tool SHALL collect those rows and include them in a single batched judge prompt sent via `sdk.askClaude` to a small/fast Claude model (Haiku-class, default `"claude-haiku-4-5-20251001"`). The prompt SHALL include for each question its `statement`, `expectedAnswer`, `acceptableAnswers[]` (if any), and `gradingNotes` (if any), and for each pending submission the row's stable key and `answerText`. The tool SHALL parse per-row verdicts from the response and SHALL call `updateAnswer(rowKey, { correct: <verdict> })` for each row to flip `correct` from undefined to the judged value.

When the batch contains no freeform questions, OR when every freeform question in the batch has zero pending rows, NO `sdk.askClaude` call SHALL be made.

#### Scenario: Batch with freeform invokes judge once

- **WHEN** `process_reveal_answers` is processing a batch with two freeform questions, each with three pending answers
- **THEN** exactly one `sdk.askClaude` call is made
- **AND** the prompt contains six submissions grouped under their respective questions
- **AND** exactly six `updateAnswer` calls flip each row's `correct` from undefined to the judged value

#### Scenario: No freeform in batch — no judge call

- **WHEN** `process_reveal_answers` is processing a batch containing only boolean and choice questions
- **THEN** zero `sdk.askClaude` calls are made
- **AND** the existing reveal flow (reaction fetch → categorize → write `SubmittedAnswer`) runs unchanged

#### Scenario: Freeform question with no submissions

- **WHEN** the batch contains a freeform question that nobody answered
- **THEN** that question contributes no entries to the judge prompt
- **AND** if all freeform questions in the batch have no submissions, no `sdk.askClaude` call is made
- **AND** the reveal payload for that question reports empty `voters.correct` and `voters.incorrect` lists

### Requirement: Freeform Judge Prompt Multi-Guess Rule

The reveal-time judge prompt SHALL instruct the model to mark as `correct: false` (with reason `multiple-guess`) any answer that hedges between two or more distinct guesses (e.g. `"Paris or London"`, `"either A or B"`, `"A | B | C"`), even when one of the guesses matches the expected answer. The prompt SHALL explicitly carve out single-answer-with-qualifier forms — `"Tokyo, Japan"`, `"Paris (capital of France)"`, `"rock and roll"` — as valid single-guess answers that should be judged on their merit.

#### Scenario: Multi-guess marked incorrect

- **WHEN** the judge is presented `answerText: "Paris or London"` against `expectedAnswer: "Paris"`
- **THEN** the per-row verdict is `correct: false`
- **AND** the verdict's reason indicates `multiple-guess`

#### Scenario: Qualifier-form accepted

- **WHEN** the judge is presented `answerText: "Tokyo, Japan"` against `expectedAnswer: "Tokyo"`
- **THEN** the per-row verdict is `correct: true`

### Requirement: Freeform Reveal Payload Carries answerText

For freeform reveal entries in the payload produced by `process_reveal_answers`, every entry in `voters.correct[]` and `voters.incorrect[]` SHALL carry an `answerText: string` field with the user's submitted text. `voters.fenceSitters[]` SHALL be `[]` and `voters.wildcards[]` SHALL be `[]` for freeform reveal entries (free-form has no fence-sitting or wildcard reactions by construction). Boolean and choice reveal entries' voter lists SHALL NOT gain an `answerText` field.

#### Scenario: Freeform voter entries carry answerText

- **WHEN** a freeform reveal entry is produced for a question with two correct answers ("Paris", "Paris, France") and one incorrect answer ("London")
- **THEN** `voters.correct[]` has two entries, each carrying the user's `answerText`
- **AND** `voters.incorrect[]` has one entry carrying `answerText: "London"`
- **AND** `voters.fenceSitters` is `[]` and `voters.wildcards` is `[]`

#### Scenario: Boolean reveal entry unchanged

- **WHEN** a boolean reveal entry is produced
- **THEN** voter entries do NOT carry `answerText`
- **AND** the payload shape is identical to today
