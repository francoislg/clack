## REMOVED Requirements

### Requirement: Reveal-Time Batch Judging via Small Model

**Reason**: The batched, echoed-key protocol mapped verdicts to rows by exact string key, so an empty or mis-keyed model response silently dropped a verdict and scored a correct answer wrong (`judge-missing-verdict`). Replaced by per-answer judging, which removes the key-mapping failure surface entirely.

**Migration**: Behavior is preserved by the ADDED "Per-Answer Reveal-Time Judging via Small Model" requirement below (multi-guess rejection, qualifier acceptance, and cross-language acceptance scenarios carry over verbatim). Resilience and prompt-shaping are covered by the two further ADDED requirements.

## ADDED Requirements

### Requirement: Per-Answer Reveal-Time Judging via Small Model

`process_reveal_answers` SHALL detect freeform questions within the batch it is about to process. For every freeform question, it SHALL collect all pending `SubmittedAnswer` rows (those with `correct === undefined`) and judge EACH submission with its OWN `sdk.askClaude` call to a small/fast Claude model (Haiku-class) — there is NO batched prompt and NO echoed per-row key. The per-answer prompt SHALL include the question's `statement`, `expectedAnswer`, `acceptableAnswers[]` (if any), `gradingNotes` (if any), and the single `answerText` under judgment. The model SHALL return a single verdict `{ correct: boolean, reason?: string }`, which maps to its submission positionally and is applied via `updateAnswer`. Per-answer calls MAY run with bounded concurrency.

The judge SHALL accept correct answers regardless of the natural language in which the user types them. When `answerText` is an unambiguous translation of `expectedAnswer` or any entry in `acceptableAnswers[]` — including translations of named entities (cities, countries, people, works), common nouns, and direct translations of free-form descriptions — the judge SHALL return `correct: true`. This cross-language acceptance SHALL NOT override any other rule: multi-guess hedges, too-broad answers, out-of-tolerance values, and ambiguous translations all continue to be rejected with their existing reasons.

#### Scenario: One judge call per submission

- **WHEN** `process_reveal_answers` processes a freeform question with three pending answers
- **THEN** three independent `sdk.askClaude` calls are made, one per submission
- **AND** each call's prompt contains exactly that submission's `answerText`
- **AND** each returned verdict flips its row's `correct` from undefined via `updateAnswer`

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

### Requirement: Resilient Verdict Resolution — Re-Ask and Never Score a Dropped Verdict Wrong

The judge SHALL parse each response strictly to `{ correct: boolean, reason?: string }`. When a response is not parseable into that shape (malformed JSON, missing or non-boolean `correct`), or the call itself errors, the judge SHALL re-ask the model up to a bounded retry budget before giving up on that submission. A dropped or malformed verdict SHALL NEVER be committed as `correct: false`.

When the retry budget is exhausted for a submission, the reveal SHALL leave that row pending (`correct` remains undefined), SHALL NOT stamp the question's `processedAt`, and SHALL surface an error for the question. Because reveal selection re-picks rows with `correct === undefined`, a subsequent reveal run SHALL re-judge only the still-pending submissions. One unresolved submission SHALL NOT block judging of the other submissions, and the reveal flow SHALL continue processing the rest of the batch.

#### Scenario: Re-ask on a malformed verdict, then succeed

- **WHEN** the judge's first response for a submission is not a clean `{ correct: boolean }` object
- **AND** a re-ask within the retry budget returns a valid verdict
- **THEN** that valid verdict is applied to the row
- **AND** the row is never marked `correct: false` on account of the malformed first response

#### Scenario: Exhausted retries leave the row pending, not wrong

- **WHEN** every attempt within the retry budget for a submission fails to yield a valid verdict
- **THEN** the row's `correct` remains undefined (pending) — it is NOT set to `false`
- **AND** the question's `processedAt` is NOT stamped
- **AND** `process_reveal_answers` surfaces an error for that question
- **AND** the other submissions for the question are still judged and committed

### Requirement: Shape-Specific Judge Prompts

The per-answer judge's system prompt SHALL be composed of a shared core (commit-to-a-single-answer rule, strict-JSON output contract) plus one rule block selected by the question's `freeformAnswerShape`. The `date` block SHALL state that a stated tolerance window is inclusive of both endpoints and that the answer's format (bare year, decade form, explicit range) does not matter as long as the value falls in the window. The `name` / `place` / `title` block SHALL state typo tolerance (~1 character for short answers, ~2 for longer) and unambiguous cross-language acceptance. Each block SHALL omit rules irrelevant to its shape.

#### Scenario: Date question uses the inclusive-tolerance block

- **WHEN** the judge prompt is built for a question with `freeformAnswerShape: "date"`
- **THEN** the system prompt states the tolerance window is inclusive of both endpoints
- **AND** states that a bare year, decade form, or explicit range are all acceptable when the value is in the window

#### Scenario: Name/place/title question uses the named-entity block

- **WHEN** the judge prompt is built for a question with `freeformAnswerShape` of `name`, `place`, or `title`
- **THEN** the system prompt states minor-typo tolerance and unambiguous cross-language acceptance
