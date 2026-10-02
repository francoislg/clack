## MODIFIED Requirements

### Requirement: Per-Answer Reveal-Time Judging via Small Model

`process_reveal_answers` SHALL detect freeform questions within the batch it is about to process. For every freeform question, it SHALL collect all pending `SubmittedAnswer` rows (those with `correct === undefined`), group them by normalized answer text (the normalization the exact-match pre-check uses), and judge EACH DISTINCT answer with its OWN `sdk.askClaude` call — there is NO batched prompt and NO echoed per-row key. The verdict for a distinct answer SHALL be applied to every submission in its group via `updateAnswer`. When the judge yields no verdict for a group after its retries, every submission in the group SHALL stay pending. The model SHALL be a small/fast Claude model (Haiku-class), except for a question stamped `judgeLeniency: "evaluate"`, which SHALL be judged by a Sonnet-tier model (per `trivia-judge-leniency`). The per-answer prompt SHALL include the question's `statement`, `expectedAnswer`, `acceptableAnswers[]` (if any), `gradingNotes` (if any), the resolved `judgeInstructions` (if any, per `trivia-judge-instructions`), and the single `answerText` under judgment. The model SHALL return a single verdict `{ correct: boolean, reason?: string }`. Per-answer calls MAY run with bounded concurrency.

The judge SHALL accept correct answers regardless of the natural language in which the user types them. When `answerText` is an unambiguous translation of `expectedAnswer` or any entry in `acceptableAnswers[]` — including translations of named entities (cities, countries, people, works), common nouns, and direct translations of free-form descriptions — the judge SHALL return `correct: true`. This cross-language acceptance SHALL NOT override any other rule: multi-guess hedges, too-broad answers, out-of-tolerance values, and ambiguous translations all continue to be rejected with their existing reasons.

#### Scenario: One judge call per distinct answer

- **WHEN** `process_reveal_answers` processes a freeform question with three pending answers whose normalized texts all differ
- **THEN** three independent `sdk.askClaude` calls are made, one per distinct answer
- **AND** each call's prompt contains exactly that answer's `answerText`
- **AND** each returned verdict flips its row's `correct` from undefined via `updateAnswer`

#### Scenario: Identical answers share one call

- **WHEN** two players submit `"the debt"` and `"The Debt"` to the same question and neither is an exact match of the key
- **THEN** exactly one judge call is made for the pair
- **AND** both rows receive the same verdict and reason

#### Scenario: Group with no verdict stays pending

- **WHEN** the judge exhausts its retries for a group of three identical answers
- **THEN** none of the three rows is scored
- **AND** the reveal reports three unjudged submissions

#### Scenario: Evaluate question uses the stronger model

- **WHEN** an answer to a question stamped `judgeLeniency: "evaluate"` reaches the model judge
- **THEN** the call uses the Sonnet-tier judge model
- **AND** an answer to a `strict`, `strict-with-typos`, or `lenient` question uses the Haiku-class judge model

#### Scenario: No freeform questions in batch

- **WHEN** `process_reveal_answers` processes a batch with only boolean and choice questions
- **THEN** no `sdk.askClaude` call is made
- **AND** the existing reveal flow is unchanged

#### Scenario: Question with no pending answers

- **WHEN** a freeform question is in the batch but has zero pending `SubmittedAnswer` rows
- **THEN** no judge call is made for that question

#### Scenario: Multi-guess shotgun rejected

- **WHEN** the judge sees an `answerText` of `"Paris or London"` against `expectedAnswer: "Paris"`
- **THEN** the judge returns `correct: false` with reason `multiple-guess`
- **AND** the resulting `SubmittedAnswer` is updated with `correct: false`

#### Scenario: Qualifier-style answer accepted

- **WHEN** the judge sees an `answerText` of `"Tokyo, Japan"` or `"Paris (France)"` against `expectedAnswer: "Tokyo"` or `expectedAnswer: "Paris"` respectively
- **THEN** the judge returns `correct: true`
- **AND** the resulting `SubmittedAnswer` is updated with `correct: true`

#### Scenario: Minor typo accepted

- **WHEN** the judge sees an `answerText` of `"Ryan Reynold"` against `expectedAnswer: "Ryan Reynolds"` (a `name`-shape question, one character off)
- **THEN** the judge returns `correct: true`
- **AND** the resulting `SubmittedAnswer` is updated with `correct: true`

#### Scenario: Date answer on the inclusive tolerance boundary accepted

- **WHEN** the judge sees an `answerText` of `"1995"` against `expectedAnswer: "2000"` with `gradingNotes: "Accept any year in [1995, 2005] (±5 of 2000)."` (a `date`-shape question)
- **THEN** the judge returns `correct: true` because `1995` is inside the inclusive window
- **AND** the resulting `SubmittedAnswer` is updated with `correct: true`

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
