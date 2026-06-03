## MODIFIED Requirements

### Requirement: Get question history tool

The Trivia plugin SHALL expose a `get_question_history` MCP tool that returns the answer key, the list of users caught cheating on the question, and the list of submitted answers, for a single question identified by `questionId` within a specified game.

The tool SHALL be gated to the `admin` role. The tool SHALL accept the following arguments:

- `game` (string, required) — the game slug; validated against `config.trivia.games[]` per the `trivia-games` capability. Read tool — succeeds against `enabled: false` games.
- `questionId` (string, required) — the ID of the trivia question to look up within the named game.

The tool SHALL look up the question only in `data/plugins/trivia/games/<game>/questions.json`, the cheat list only in `data/plugins/trivia/games/<game>/cheats.json`, and the answers only in `data/plugins/trivia/games/<game>/answers.json`. The `displayName` SHALL be looked up from the global `data/plugins/trivia/users.json`.

The tool SHALL return the question's answer key in an `answersFormat`-discriminated shape, dispatching through the per-format `AnswerTypeHandler` registry so each format owns its own response projection:

- **Boolean questions** (`answersFormat: "boolean"`): `{ answersFormat: "boolean", isTrue: boolean, responses: Array<{ userId, displayName, answer: boolean, correct?: boolean }> }`. Each response entry's `answer` field reflects the stored `SubmittedAnswer.answer` boolean.
- **Choice questions** (`answersFormat: "choice"`): `{ answersFormat: "choice", choices: string[], correctIndex: number, responses: Array<{ userId, displayName, answerIndex: number, correct?: boolean }> }`. Each response entry's `answerIndex` reflects the stored `SubmittedAnswer.answerIndex`.
- **Freeform questions** (`answersFormat: "freeform"`): `{ answersFormat: "freeform", expectedAnswer: string, acceptableAnswers?: string[], gradingNotes?: string, responses: Array<{ userId, displayName, answerText: string, correct?: boolean, judgeReason?: string }> }`. Each response entry's `answerText` reflects the stored `SubmittedAnswer.answerText`. When the reveal-time judge has stamped a verdict on the row, `correct` is the boolean verdict and `judgeReason` (when present) is the short label the judge emitted (e.g. `"multiple-guess"`, `"too-broad"`, `"typo-too-far"`, `"out-of-tolerance"`, `"judge-error"`). Rows still pending judging carry `correct: undefined` and SHALL be returned with `correct` absent from the response entry rather than present-with-undefined.

The tool SHALL ALSO return, regardless of format:

- `questionType: "fact" | "topical"` — projected from the stored `TriviaQuestion.questionType` (defaults to `"fact"` for legacy rows).
- `cheaterUserIds` (string array) — the deduplicated list of `cheaterUserId` values from every entry in the named game's `cheats.json` whose `questionId` matches the requested question.

When the resolved question record carries `context`, `sourceUrl`, or `eventDate`, the tool SHALL include those fields in the response payload (cross-format extras).

The tool's description SHALL instruct Claude that cheater identities are internal — Claude MUST NOT name caught cheaters in any user-facing output unless an admin explicitly asks for the list. The description SHALL also document all three format response shapes so Claude knows which fields to expect for each.

This requirement replaces a prior implementation that silently returned the boolean response shape for freeform questions (the `isChoice ? ... : booleanShape` ternary defaulted freeform to boolean), which produced misleading output. The new dispatch-through-handler approach ensures each format returns its correct shape.

#### Scenario: Returns boolean answer key, cheaters, and responses scoped to the game

- **WHEN** `get_question_history` is called with `game: "main"` and a `questionId` for a boolean question in that game
- **THEN** the response includes `answersFormat: "boolean"`, `questionType`, `isTrue`, plus the `cheaterUserIds` and `responses` arrays scoped to that game
- **AND** each response entry carries `answer: boolean`
- **AND** no response entry carries `answerIndex` or `answerText`

#### Scenario: Returns choice answer key, cheaters, and responses

- **WHEN** `get_question_history` is called for a choice question
- **THEN** the response includes `answersFormat: "choice"`, `questionType`, `choices`, `correctIndex`, plus `cheaterUserIds` and `responses` arrays
- **AND** each response entry carries `answerIndex: number`
- **AND** no response entry carries `answer` or `answerText`

#### Scenario: Returns freeform answer key, cheaters, and responses

- **WHEN** `get_question_history` is called for a freeform question with stored `expectedAnswer: "Paris"`, optional `acceptableAnswers: ["Paris, France"]`, and `gradingNotes: "Accept any reasonable form."`
- **THEN** the response includes `answersFormat: "freeform"`, `questionType`, `expectedAnswer: "Paris"`, `acceptableAnswers: ["Paris, France"]`, `gradingNotes: "Accept any reasonable form."`, plus `cheaterUserIds` and `responses` arrays
- **AND** each response entry carries `answerText: string`
- **AND** when the judge has scored an entry, the entry carries `correct: boolean`
- **AND** when the judge stamped a `judgeReason` on the row, the entry carries `judgeReason: string`
- **AND** no response entry carries `answer` or `answerIndex`

#### Scenario: Pending freeform responses omit `correct`

- **GIVEN** a freeform question with three submitted answers, none yet scored by the judge (`SubmittedAnswer.correct === undefined` on every row)
- **WHEN** `get_question_history` is called for that question
- **THEN** every entry in `responses[]` carries `answerText` and `userId` / `displayName`
- **AND** no entry carries a `correct` field (absence indicates pending judging)
- **AND** no entry carries a `judgeReason` field

#### Scenario: Mixed-state freeform responses

- **GIVEN** a freeform question with two scored responses (one `correct: true`, one `correct: false` with `judgeReason: "multiple-guess"`) and one pending response
- **WHEN** `get_question_history` is called
- **THEN** the scored entries carry `correct` (with the relevant boolean) and the false entry carries `judgeReason: "multiple-guess"`
- **AND** the pending entry carries neither `correct` nor `judgeReason`

#### Scenario: Topical question history includes sourceUrl

- **WHEN** `get_question_history` is called for a topical question with a stored `sourceUrl`
- **THEN** the response includes `sourceUrl` and (when present) `eventDate`
- **AND** the per-format shape (boolean / choice / freeform) is unaffected

#### Scenario: Question with context surfaces the context value

- **WHEN** `get_question_history` is called for a question whose record carries `context: "Quebec"`
- **THEN** the response includes `context: "Quebec"`
- **AND** the per-format shape (boolean / choice / freeform) is unaffected
