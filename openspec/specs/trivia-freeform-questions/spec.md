# trivia-freeform-questions

## Purpose

Support for free-form trivia questions where users submit text answers that are judged at reveal time using a Haiku-class Claude model. Includes answer storage, modal UI for submission, batch judging, and reveal rendering.

## Requirements

### Requirement: Freeform Answer Format

The trivia plugin SHALL support `"freeform"` as a third value of `TriviaQuestion.answersFormat`, alongside `"boolean"` and `"choice"`. A freeform question carries `expectedAnswer: string` (required, the canonical answer authored at generation time), and MAY carry `acceptableAnswers?: string[]` (variants pre-enumerated by the question author) and `gradingNotes?: string` (a hint to the reveal-time judge about acceptable forms or edge cases). A freeform question SHALL NOT carry `isTrue`, `choices`, or `correctIndex`.

#### Scenario: Freeform record shape

- **WHEN** a `TriviaQuestion` is written with `answersFormat: "freeform"`
- **THEN** the record carries `expectedAnswer: string`
- **AND** MAY carry `acceptableAnswers?: string[]` and `gradingNotes?: string`
- **AND** does NOT carry `isTrue`, `choices`, or `correctIndex`

#### Scenario: Cross-format field rejection

- **WHEN** `save_question` is called with `answersFormat: "freeform"` and either `isTrue`, `choices`, or `correctIndex` supplied
- **THEN** the tool rejects with an error indicating the field is not valid for freeform questions

#### Scenario: Freeform requires expectedAnswer

- **WHEN** `save_question` is called with `answersFormat: "freeform"` and `expectedAnswer` missing or empty
- **THEN** the tool rejects with an error indicating `expectedAnswer` is required for freeform questions

### Requirement: Freeform Answer Submission via Slack Modal

When a question with `answersFormat: "freeform"` is posted, the question card SHALL include a Slack button labelled `Answer` whose `action_id` is `plugin:trivia:freeform-answer:<questionId>`. Clicking the button SHALL open a Slack modal owned by the trivia plugin (`callback_id` = `plugin:trivia:freeform-modal:<questionId>`) containing:

- The question's `statement` rendered read-only.
- A single-line text input for the user's answer.
- If the user already has a pending answer (a `SubmittedAnswer` row with `correct === undefined`), the text input SHALL be pre-filled with that prior answer.
- If the question has been processed (its `processedAt` is set), the modal SHALL render in a locked read-only mode showing the user's prior submission and the judged verdict (when the user submitted) or a "no answer submitted" message (when they did not), and SHALL NOT accept a new submission.

Submitting the modal SHALL write or update a `SubmittedAnswer` row with `answerText: <input>`, `correct: undefined`, `userId`, `questionId`, and `timestamp`. The trivia plugin SHALL NOT post any public message or reaction reflecting the submission.

#### Scenario: First-time answer

- **WHEN** a user clicks the `Answer` button on a freeform question for which they have no prior `SubmittedAnswer` row
- **THEN** the modal opens with an empty text input
- **AND** on submit, a new `SubmittedAnswer` row is written with `answerText: <input>`, `correct: undefined`

#### Scenario: Editing an in-flight answer

- **WHEN** a user clicks the `Answer` button on a freeform question for which they already have a pending `SubmittedAnswer` row (`correct === undefined`)
- **THEN** the modal opens with the text input pre-filled with the prior `answerText`
- **AND** on submit, the existing row is updated in place (new `answerText`, new `timestamp`)
- **AND** no duplicate row is written

#### Scenario: Locked modal after reveal

- **WHEN** a user clicks the `Answer` button on a freeform question whose `processedAt` is set
- **THEN** the modal opens in read-only mode showing the user's prior submission and the judged verdict (or a "no answer submitted" message)
- **AND** no submit affordance is rendered
- **AND** no row is written or updated

### Requirement: Pending Free-Form Answer Storage Semantics

The `SubmittedAnswer` interface SHALL allow `correct?: boolean` to be undefined. `correct === undefined` denotes a pending freeform submission awaiting reveal-time validation. All readers of `SubmittedAnswer.correct` SHALL treat undefined as "exclude from results":

- `computeLeaderboard` aggregation SHALL skip rows with `correct === undefined` entirely — they do NOT increment `totalAnswered` and do NOT increment `totalCorrect`.
- Answer-history payloads (`getQuestionHistory`, `findPreviousQuestions` if the answer is included) SHALL emit `correct` as an optional boolean and document that absence means "not yet scored."
- Boolean and choice answers SHALL continue to write `correct` synchronously at submission time as before — only freeform submissions ever have `correct === undefined`.

#### Scenario: Pending row excluded from leaderboard

- **WHEN** the answers store contains a freeform `SubmittedAnswer` for `userA` with `correct === undefined`
- **AND** `computeLeaderboard` is called over this answer set
- **THEN** `userA`'s `totalAnswered` does NOT include this row
- **AND** `userA`'s `totalCorrect` does NOT include this row

#### Scenario: Boolean answer still writes correct synchronously

- **WHEN** `submit_answers` writes a boolean answer row
- **THEN** `correct` is set to the result of `answer === question.isTrue` at write time
- **AND** is never undefined

### Requirement: Free-Form Answer Update Data-Layer Op

The trivia plugin's scoped data layer SHALL expose `updateAnswer(id: string, partial: Partial<SubmittedAnswer>): Promise<void>` that locates a single existing answer row by `id` and merges the supplied partial into it. The op SHALL be a no-op (logged warn) when no row matches `id`. This is required so reveal-time judging can flip `correct` from undefined to the verdict without rewriting the rest of the row.

#### Scenario: Update flips correct

- **WHEN** `updateAnswer("ans-42", { correct: true })` is called and a row with `id: "ans-42"` exists with `correct: undefined`
- **THEN** the row is updated to `correct: true`
- **AND** all other fields on the row are preserved

#### Scenario: Update of unknown id

- **WHEN** `updateAnswer("ans-ghost", { correct: true })` is called and no row matches
- **THEN** the call resolves without error
- **AND** the answers store is unchanged
- **AND** a warning is logged

Note: `SubmittedAnswer` rows do not currently carry an explicit `id` field — implementation SHALL either add one at write time or use the natural composite key `(userId, questionId)`. The choice is captured in the design document; the spec requires only that `updateAnswer` resolve a unique row by a stable identifier.

### Requirement: Reveal-Time Batch Judging via Small Model

`process_reveal_answers` SHALL detect freeform questions within the batch it is about to process. For every freeform question in that batch, it SHALL collect all pending `SubmittedAnswer` rows (those with `correct === undefined`) for that question, assemble a single batched judge prompt covering all of them, invoke a small/fast Claude model (Haiku-class) via `sdk.askClaude`, parse the per-answer verdicts, and apply each verdict via `updateAnswer`. The judge prompt SHALL include for each freeform question: the `statement`, the `expectedAnswer`, the `acceptableAnswers[]` (if any), and the `gradingNotes` (if any). Each answer entry in the batched prompt SHALL include `userId` (or a stable identifier from the row) and the `answerText`.

#### Scenario: Batch judge runs once per reveal

- **WHEN** `process_reveal_answers` is processing a batch containing two freeform questions, each with three pending answers (six total submissions)
- **THEN** exactly one `sdk.askClaude` call is made
- **AND** the prompt contains all six submissions grouped under their respective questions
- **AND** the parsed response yields six per-answer verdicts
- **AND** six `updateAnswer` calls flip each row's `correct` from undefined to the verdict

#### Scenario: Multi-guess shotgun rejected

- **WHEN** the judge sees an `answerText` of `"Paris or London"` against `expectedAnswer: "Paris"`
- **THEN** the judge returns `correct: false` with reason `multiple-guess`
- **AND** the resulting `SubmittedAnswer` is updated with `correct: false`

#### Scenario: Qualifier-style answer accepted

- **WHEN** the judge sees an `answerText` of `"Tokyo, Japan"` or `"Paris (France)"` against `expectedAnswer: "Tokyo"` or `expectedAnswer: "Paris"` respectively
- **THEN** the judge returns `correct: true`
- **AND** the resulting `SubmittedAnswer` is updated with `correct: true`

#### Scenario: No freeform questions in batch

- **WHEN** `process_reveal_answers` is processing a batch with only boolean and choice questions
- **THEN** no `sdk.askClaude` call is made
- **AND** the existing reveal flow is unchanged

#### Scenario: Question with no pending answers

- **WHEN** a freeform question is in the batch but has zero pending `SubmittedAnswer` rows
- **THEN** that question contributes no entries to the judge prompt
- **AND** if all freeform questions in the batch have no submissions, no `sdk.askClaude` call is made

### Requirement: Reveal Payload Includes Quoted Answer Text

The reveal payload produced by `process_reveal_answers` for a freeform question SHALL include each voter's `answerText` in the `voters.correct[]` and `voters.incorrect[]` entries, so the renderer can quote the player's submission. Boolean and choice voter lists are unaffected (their entries do not gain an `answerText` field).

#### Scenario: Voter entries carry answerText

- **WHEN** `process_reveal_answers` produces a reveal entry for a freeform question
- **THEN** every entry in `voters.correct[]` and `voters.incorrect[]` carries an `answerText: string` field with the user's submitted text
- **AND** boolean / choice reveal entries' voter lists do NOT carry `answerText`

#### Scenario: No fence-sitters or wildcards on freeform

- **WHEN** a freeform reveal entry is produced
- **THEN** `voters.fenceSitters` is `[]`
- **AND** `voters.wildcards` is `[]`
- **AND** only `voters.correct` and `voters.incorrect` may carry entries

### Requirement: Freeform Generation Flow in Scheduled Prompts

The scheduled question-posting prompt SHALL dispatch on `suggestedAnswersFormat × suggestedQuestionType` as a 3×2 matrix: `{boolean, choice, freeform} × {fact, topical}`. The two new freeform flows (`FREEFORM_FACT_FLOW_STEPS`, `FREEFORM_TOPICAL_FLOW_STEPS`) SHALL instruct Claude to write the `statement`, the canonical `expectedAnswer`, and OPTIONALLY enumerate semantic variants in `acceptableAnswers[]` and any tricky-case hints in `gradingNotes`. The topical-freeform path additionally requires the same WebSearch-driven research step and `sourceUrl` capture as other topical flows.

#### Scenario: Fact-freeform generation

- **WHEN** `get_ideas` rolls `suggestedAnswersFormat: "freeform"` and `suggestedQuestionType: "fact"`
- **THEN** the scheduled prompt routes to `FREEFORM_FACT_FLOW_STEPS`
- **AND** the path instructs Claude to write the statement plus `expectedAnswer` plus optional `acceptableAnswers` / `gradingNotes`
- **AND** the path does NOT invoke `WebSearch`

#### Scenario: Topical-freeform generation

- **WHEN** `get_ideas` rolls `suggestedAnswersFormat: "freeform"` and `suggestedQuestionType: "topical"`
- **THEN** the scheduled prompt routes to `FREEFORM_TOPICAL_FLOW_STEPS`
- **AND** the path runs the WebSearch research step (the same `contextPriority` descent rule as other topical paths)
- **AND** the saved question carries `sourceUrl` (required), `eventDate` (optional), and the freeform fields

### Requirement: Freeform Question Posting Behavior

`post_questions` SHALL render freeform questions with an `Answer` button (Slack `actions` block) whose `action_id` is `plugin:trivia:freeform-answer:<questionId>` and whose label is `Answer`. The tool SHALL NOT add any reactions to freeform question messages (`deriveReactions` returns `[]` for `answersFormat === "freeform"`).

#### Scenario: Freeform card has Answer button

- **WHEN** `post_questions` posts a freeform question
- **THEN** the posted message includes a Slack `actions` block with one button labelled `Answer` and `action_id: "plugin:trivia:freeform-answer:<questionId>"`

#### Scenario: Freeform card has no reactions

- **WHEN** `post_questions` posts a freeform question
- **THEN** the question record's `addDeliveryReactions` step is skipped (empty reaction list)
- **AND** no `+1`/`-1` or numeric reactions are seeded on the message

