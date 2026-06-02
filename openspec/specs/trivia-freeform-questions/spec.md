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

### Requirement: Exact-Match Pre-Check Bypasses the Reveal Judge

Before invoking the per-answer model judge, `judgeAnswer` SHALL run a deterministic exact-match pre-check. The pre-check SHALL normalize the player's `answerText` and compare it for equality against the normalized `expectedAnswer` and the normalized form of every entry in `acceptableAnswers` (when present). On a match, `judgeAnswer` SHALL return `{ correct: true, reason: "exact-match" }` immediately, WITHOUT calling `sdk.askClaude` and WITHOUT entering the retry loop. On no match, the answer SHALL fall through to the existing model judge path unchanged.

Normalization SHALL be maximally conservative to eliminate false-accept risk: it SHALL trim leading/trailing whitespace, lowercase the text, and collapse internal runs of whitespace to a single space. It SHALL NOT remove punctuation and SHALL NOT fold accents or other diacritics. Consequently the pre-check is a strict subset of what the model judge would accept: it can only accept answers the judge would also accept, never reject.

#### Scenario: Exact canonical answer skips the model

- **WHEN** a player's `answerText` is `"Paris"` against `expectedAnswer: "Paris"`
- **THEN** `judgeAnswer` returns `{ correct: true, reason: "exact-match" }`
- **AND** no `sdk.askClaude` call is made for that answer

#### Scenario: Case- and whitespace-insensitive match skips the model

- **WHEN** a player's `answerText` is `"  the   ROMAN empire "` against `expectedAnswer: "The Roman Empire"`
- **THEN** `judgeAnswer` returns `{ correct: true, reason: "exact-match" }`
- **AND** no `sdk.askClaude` call is made for that answer

#### Scenario: Match against an acceptable variant skips the model

- **WHEN** a player's `answerText` is `"NYC"` against `expectedAnswer: "New York City"` with `acceptableAnswers: ["NYC", "New York"]`
- **THEN** `judgeAnswer` returns `{ correct: true, reason: "exact-match" }`
- **AND** no `sdk.askClaude` call is made for that answer

#### Scenario: Non-matching answer falls through to the model judge

- **WHEN** a player's `answerText` is `"Tokyo, Japan"` against `expectedAnswer: "Tokyo"` (which the pre-check does not treat as equal)
- **THEN** the exact-match pre-check does not fire
- **AND** the answer is judged by the existing model path, which returns `correct: true` for the qualifier form as before

#### Scenario: Pre-check never folds materially-different strings together

- **WHEN** a player's `answerText` is `"C"` against `expectedAnswer: "C++"`, or `"5"` against `expectedAnswer: "$5"`, or `"cafe"` against `expectedAnswer: "café"`
- **THEN** the exact-match pre-check does not fire (punctuation and accents are not stripped)
- **AND** the answer falls through to the model judge for its decision

#### Scenario: Multi-guess hedge still rejected

- **WHEN** a player's `answerText` is `"Paris or London"` against `expectedAnswer: "Paris"`
- **THEN** the exact-match pre-check does not fire (the strings are not equal after normalization)
- **AND** the model judge returns `correct: false` with reason `multiple-guess` as before

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

The per-answer judge's system prompt SHALL be composed of a shared core (commit-to-a-single-answer rule, the universal integrity guards — reject multi-guess, reject too-broad, reject materially-different, treat acceptable variants as additional correct, honor grading Notes — and the strict-JSON output contract), PLUS a matching-forgiveness block selected by the question's resolved `judgeLeniency` preset (see the `trivia-judge-leniency` capability), PLUS one shape rule block selected by the question's `freeformAnswerShape`. The leniency preset and the shape block are orthogonal: the preset governs how forgiving string matching is; the shape block governs value semantics for that shape.

The `date` block SHALL state that a stated tolerance window is inclusive of both endpoints and that the answer's format (bare year, decade form, explicit range) does not matter as long as the value falls in the window. The `name` / `place` / `title` block SHALL state unambiguous cross-language acceptance and its shape-specific guards (accept synonyms and reasonable variants; reject too-broad answers). Typo tolerance SHALL NOT be hardcoded in the shape block: it is contributed by the `strict-with-typos` preset (the default) and is absent under the `strict` preset. Each block SHALL omit rules irrelevant to its shape.

The resolved preset SHALL be read from the question record's `judgeLeniency` stamp, defaulting to `strict-with-typos` when the stamp is absent.

#### Scenario: Date question uses the inclusive-tolerance block

- **WHEN** the judge prompt is built for a question with `freeformAnswerShape: "date"`
- **THEN** the system prompt states the tolerance window is inclusive of both endpoints
- **AND** states that a bare year, decade form, or explicit range are all acceptable when the value is in the window

#### Scenario: Name/place/title question uses the named-entity block

- **WHEN** the judge prompt is built for a question with `freeformAnswerShape` of `name`, `place`, or `title`
- **THEN** the system prompt states unambiguous cross-language acceptance and the named-entity guards (synonyms accepted, too-broad rejected)

#### Scenario: Default preset preserves typo tolerance

- **WHEN** the judge prompt is built for a question whose resolved `judgeLeniency` is `strict-with-typos` (the default, including legacy unstamped records)
- **THEN** the matching-forgiveness block includes the minor-typo tolerance and loose-writing tolerance
- **AND** for named-entity answers (name/place/title) the effective rule set matches the pre-change default judge behavior; the same tolerance also applies to the other freeform shapes (where typo tolerance was previously absent)

#### Scenario: Strict preset omits typo tolerance

- **WHEN** the judge prompt is built for a question whose resolved `judgeLeniency` is `strict`
- **THEN** the matching-forgiveness block omits the typo tolerance
- **AND** still forgives case, numeral↔word substitution, decade form, and singular/plural variants

