## ADDED Requirements

### Requirement: User-Facing TS-Rendered Strings Are Localized

Every user-facing English literal rendered directly by the trivia plugin's TypeScript code SHALL be replaced with a `sdk.t(key, vars?)` call against a registered plugin dictionary. The plugin SHALL register both `en` and `fr` tables covering at minimum:

- **Live roster footer** — `roster.answered_label` (today `📝 *Answered:*`), `roster.no_answers_yet` (today `(no answers yet)`). All four call sites in `buildRosterBlock` / `renderHidden` SHALL emit text composed from `t(...)`.
- **Boolean question buttons** — `button.true` (today `👍 TRUE`), `button.false` (today `👎 FALSE`).
- **Freeform question `Answer` button** — `button.answer` (today `Answer`).
- **Freeform answer modal** — `modal.title_active` (today `Trivia — your answer`), `modal.title_locked` (today `Trivia — answered`), `modal.submit` (today `Submit answer`), `modal.cancel` (today `Cancel`), `modal.close` (today `Close`), `modal.input_label` (today `Your answer`), `modal.input_placeholder` (today `Type your answer`), `modal.input_hint` (today `You can re-open this modal and edit your answer until the reveal.`), `modal.question_header` (today `Question ({category})`), and four verdict lines (`modal.verdict_no_submission`, `modal.verdict_awaiting`, `modal.verdict_correct`, `modal.verdict_incorrect`).

When `config.json` `language` is `"fr"`, each of these surfaces SHALL render the corresponding FR translation. When `"en"` or unset, each SHALL render the EN source. User-authored content (question text, choice labels, user mentions, numeric counts) SHALL remain untranslated.

#### Scenario: French workspace renders FR roster footer

- **GIVEN** `config.json` contains `"language": "fr"`
- **AND** a freeform question has zero submitted answers
- **WHEN** `buildRosterBlock` runs
- **THEN** the resulting context block's text begins with the FR equivalent of `📝 *Answered:*`
- **AND** the body shows the FR equivalent of `(no answers yet)`

#### Scenario: English workspace renders EN roster footer

- **GIVEN** `config.json` has no `language` field OR `"language": "en"`
- **WHEN** `buildRosterBlock` runs on an empty answer set
- **THEN** the resulting context block's text begins with `📝 *Answered:*`
- **AND** the body shows `(no answers yet)`

#### Scenario: French workspace renders FR boolean buttons

- **GIVEN** `config.json` contains `"language": "fr"`
- **WHEN** the boolean answer-type handler appends vote buttons to a question card
- **THEN** the TRUE button label is the FR translation of `👍 TRUE`
- **AND** the FALSE button label is the FR translation of `👎 FALSE`

#### Scenario: French workspace renders FR freeform `Answer` button

- **GIVEN** `config.json` contains `"language": "fr"`
- **WHEN** the freeform answer-type handler appends the answer button to a question card
- **THEN** the button label is the FR translation of `Answer`

#### Scenario: French workspace renders FR freeform modal

- **GIVEN** `config.json` contains `"language": "fr"`
- **WHEN** `buildFreeformModal` is called in active (non-locked) mode
- **THEN** the modal title, submit label, cancel label, input label, placeholder, hint, and question header are all the corresponding FR translations
- **AND** user-authored `question.statement` is rendered verbatim, not translated

#### Scenario: Locked freeform modal renders FR verdict lines

- **GIVEN** `config.json` contains `"language": "fr"`
- **AND** `buildFreeformModal` is called with `locked: true` for each of the four verdict states (no submission, awaiting reveal, correct, incorrect)
- **THEN** the verdict section's text is the corresponding FR template with the user's `answerText` interpolated where applicable

#### Scenario: User-authored content is not translated

- **GIVEN** `config.json` contains `"language": "fr"`
- **AND** a question's `statement`, `category`, and `choices` are stored exactly as authored
- **WHEN** any localized surface renders these values via `{}` interpolation
- **THEN** the surrounding labels are the FR translations
- **AND** the authored values appear verbatim in the rendered output

## MODIFIED Requirements

### Requirement: Reveal-Time Batch Judging via Small Model

`process_reveal_answers` SHALL detect freeform questions within the batch it is about to process. For every freeform question in that batch, it SHALL collect all pending `SubmittedAnswer` rows (those with `correct === undefined`) for that question, assemble a single batched judge prompt covering all of them, invoke a small/fast Claude model (Haiku-class) via `sdk.askClaude`, parse the per-answer verdicts, and apply each verdict via `updateAnswer`. The judge prompt SHALL include for each freeform question: the `statement`, the `expectedAnswer`, the `acceptableAnswers[]` (if any), and the `gradingNotes` (if any). Each answer entry in the batched prompt SHALL include `userId` (or a stable identifier from the row) and the `answerText`.

The judge SHALL accept correct answers regardless of the natural language in which the user types them. When `answerText` is an unambiguous translation of `expectedAnswer` or any entry in `acceptableAnswers[]` — including translations of named entities (cities, countries, people, works), common nouns, and direct translations of free-form descriptions — the judge SHALL return `correct: true`. This cross-language acceptance SHALL NOT override any other rule: multi-guess hedges, too-broad answers, out-of-tolerance values, and ambiguous translations all continue to be rejected with their existing reasons.

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

#### Scenario: Cross-language named entity accepted

- **WHEN** the judge sees an `answerText` of `"Empire romain"` against `expectedAnswer: "Roman Empire"` (with no `acceptableAnswers` entries)
- **THEN** the judge returns `correct: true`
- **AND** the resulting `SubmittedAnswer` is updated with `correct: true`

#### Scenario: Cross-language free-form descriptor accepted

- **WHEN** the judge sees an `answerText` of `"photosynthèse"` against `expectedAnswer: "photosynthesis"`
- **THEN** the judge returns `correct: true`

#### Scenario: Ambiguous cross-language match still rejected

- **WHEN** the judge sees an `answerText` whose natural-language translation could match either `expectedAnswer` or a materially different concept (e.g. an answer that translates to a near-but-wrong term)
- **THEN** the judge returns `correct: false`
- **AND** existing rejection reasons (`typo-too-far`, `multiple-guess`, etc.) still apply when relevant
