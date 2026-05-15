## MODIFIED Requirements

### Requirement: save_question replaces generate_question
The system SHALL provide a `save_question` MCP tool (member role) that saves a new trivia question. The tool SHALL accept one of two argument shapes determined by the `type` field:

**Boolean shape** (`type: "boolean"` or absent): `category`, `statement`, `isTrue`, and `emojis`. The stored record carries `type: "boolean"` (explicitly set, even when the caller omitted the field) and `isTrue`, and does NOT carry `choices` or `correctIndex`.

**Choice shape** (`type: "choice"`): `category`, `statement`, `emojis`, `choices: string[]` (length within active `[min, max]` bounds from `trivia.choices`, default `[2, 4]`), and `correctIndex: number` (integer in `[0, choices.length)`). The stored record carries `type: "choice"`, `choices`, and `correctIndex`, and does NOT carry `isTrue`.

The tool SHALL validate (in addition to the existing statement-length checks):

- `type` is either `"boolean"`, `"choice"`, or absent (treated as `"boolean"`).
- For the choice shape: `choices.length` is within the active `[min, max]` bounds, `correctIndex` is an integer in `[0, choices.length)`, every choice string is 1–100 characters after trimming, and `new Set(choices.map(c => c.trim().toLowerCase())).size === choices.length` (no duplicate or whitespace/case-equivalent choice strings).
- For the choice shape: `isTrue` is not provided.
- For the boolean shape: `choices` and `correctIndex` are not provided.

On validation failure, the tool SHALL return a structured error indicating which constraint failed.

#### Scenario: Save a valid boolean question
- **WHEN** `save_question` is called with a valid category, statement, `isTrue`, and emojis (no `type` field)
- **THEN** the question is saved to `questions.json` with `type: "boolean"`, the provided fields, plus a generated ID and `createdAt` timestamp

#### Scenario: Save a valid choice question
- **WHEN** `save_question` is called with `type: "choice"`, a valid category, statement, emojis, `choices` of length 4, and `correctIndex: 2`
- **THEN** the question is saved to `questions.json` with `type: "choice"`, the provided choices and correctIndex, plus a generated ID and `createdAt` timestamp

#### Scenario: Statement too short
- **WHEN** `save_question` is called with a statement shorter than 10 characters
- **THEN** the tool returns a validation error

#### Scenario: Statement too long
- **WHEN** `save_question` is called with a statement longer than 500 characters
- **THEN** the tool returns a validation error

#### Scenario: Choice question with correctIndex out of range
- **WHEN** `save_question` is called with `type: "choice"`, `choices` of length 4, and `correctIndex: 4`
- **THEN** the tool returns a validation error indicating `correctIndex` must be in `[0, choices.length)`

#### Scenario: Choice question with duplicate choices
- **WHEN** `save_question` is called with `type: "choice"` and `choices: ["Paris", "London", "Paris", "Rome"]`
- **THEN** the tool returns a validation error indicating choices must be unique

#### Scenario: Choice question outside configured bounds
- **GIVEN** active `trivia.choices` bounds of `min: 2, max: 4`
- **WHEN** `save_question` is called with `type: "choice"` and `choices` of length 5
- **THEN** the tool returns a validation error indicating choices length is outside the bounds

#### Scenario: Choice question with isTrue rejected
- **WHEN** `save_question` is called with `type: "choice"` AND `isTrue: true`
- **THEN** the tool returns a validation error indicating `isTrue` is invalid for choice questions

#### Scenario: Boolean question with choices rejected
- **WHEN** `save_question` is called with `type: "boolean"` AND `choices: ["A", "B"]`
- **THEN** the tool returns a validation error indicating `choices` is invalid for boolean questions

### Requirement: Find previous questions response excludes the answer key

The `find_previous_questions` MCP tool SHALL NOT include the question's answer-key fields (`isTrue` for boolean questions, `correctIndex` for choice questions) in any element of its returned `questions` array, regardless of caller role. The tool SHALL return only search-safe metadata: `id`, `type` (when present on the stored record), `category`, `statement`, `emojis`, `createdAt`, and (when present on the stored record) `postedAt` and `messageLink`. For choice questions, the tool SHALL include the `choices` array (the choice strings themselves are not the answer key — the answer key is the `correctIndex`).

This requirement closes a pre-existing exposure where any session at the `member` tier could prompt Clack into surfacing the canonical answer key for past questions through the search tool. The tool's gating remains `member`; the response shape is what changes.

#### Scenario: Boolean response payload omits isTrue

- **WHEN** `find_previous_questions` is invoked with any combination of valid arguments and matches at least one stored boolean question
- **THEN** every boolean element of the returned `questions` array contains `id`, `category`, `statement`, `emojis`, `createdAt`, and (when present on the stored record) `type`, `postedAt`, and `messageLink`
- **AND** no element contains an `isTrue` field

#### Scenario: Choice response payload omits correctIndex but includes choices

- **WHEN** `find_previous_questions` is invoked and matches at least one stored choice question
- **THEN** every choice element of the returned `questions` array contains `id`, `type: "choice"`, `category`, `statement`, `emojis`, `choices`, `createdAt`, and (when present on the stored record) `postedAt` and `messageLink`
- **AND** no element contains a `correctIndex` field
- **AND** no element contains an `isTrue` field

#### Scenario: Empty result is unaffected

- **WHEN** `find_previous_questions` is invoked with criteria that match no questions
- **THEN** the tool returns an empty `questions` array
- **AND** no answer-key data is returned in any other field of the response

### Requirement: Get question history tool

The Trivia plugin SHALL expose a `get_question_history` MCP tool that returns the answer key, the list of users caught cheating on the question, and the list of submitted answers, for a single question identified by `questionId`.

The tool SHALL be gated to the `admin` role. The tool SHALL accept the following arguments:

- `questionId` (string, required) — the ID of the trivia question to look up.

The tool SHALL return the question's answer key in a type-discriminated shape:

- For boolean questions: `type: "boolean"` and `isTrue: boolean`.
- For choice questions: `type: "choice"`, `choices: string[]`, and `correctIndex: number`.

The tool SHALL also return:

- `cheaterUserIds` (string array) — the deduplicated list of `cheaterUserId` values from every `cheats.json` entry whose `questionId` matches the requested question.
- `responses` (array of objects) — every entry from `answers.json` whose `questionId` matches, projected to `{ userId, displayName, answer?, answerIndex?, correct }`. The `displayName` SHALL be looked up from `users.json`; when no user record exists, `displayName` SHALL fall back to `userId`. Each response entry carries `answer` for boolean-question answers and `answerIndex` for choice-question answers, mirroring the stored row's shape.

The tool's description SHALL instruct Claude that cheater identities are internal — Claude MUST NOT name caught cheaters in any user-facing output unless an admin explicitly asks for the list.

#### Scenario: Returns boolean answer key, cheaters, and responses

- **GIVEN** a question `q42` exists in `questions.json` with `type: "boolean"` (or absent) and `isTrue: true`
- **AND** `cheats.json` contains two entries with `questionId: "q42"` and `cheaterUserId` values `"U777"` and `"U888"`, plus one entry with a different `questionId`
- **AND** `answers.json` contains three entries with `questionId: "q42"` for users `U1`, `U2`, `U777`, plus an entry for a different `questionId`
- **AND** `users.json` contains records for `U1`, `U2`, and `U777` with `displayName` fields
- **WHEN** `get_question_history` is called with `questionId: "q42"`
- **THEN** the response contains `type: "boolean"` and `isTrue: true`
- **AND** `cheaterUserIds` is the deduplicated set `["U777", "U888"]` (order is not significant)
- **AND** `responses` contains exactly three entries, one per `q42` answer, each with the matching `userId`, the `displayName` from `users.json`, and the recorded `answer` and `correct`
- **AND** no entries from other questions appear in any field of the response

#### Scenario: Returns choice answer key, cheaters, and responses

- **GIVEN** a question `q50` exists in `questions.json` with `type: "choice"`, `choices: ["A", "B", "C", "D"]`, and `correctIndex: 1`
- **AND** `answers.json` contains two entries with `questionId: "q50"` and `answerIndex` values `1` and `3`
- **WHEN** `get_question_history` is called with `questionId: "q50"`
- **THEN** the response contains `type: "choice"`, `choices: ["A", "B", "C", "D"]`, and `correctIndex: 1`
- **AND** `responses` contains two entries with `answerIndex` set (and `answer` absent)

#### Scenario: Empty cheater list when no cheats recorded

- **GIVEN** a question `q43` exists with no entries in `cheats.json`
- **WHEN** `get_question_history` is called with `questionId: "q43"`
- **THEN** `cheaterUserIds` is an empty array
- **AND** `responses` reflects whatever answers exist for `q43` (possibly empty)

#### Scenario: Empty responses for a freshly posted question

- **GIVEN** a question `q44` was just saved by `save_question` and no `submit_answers` call has yet referenced it
- **WHEN** `get_question_history` is called with `questionId: "q44"`
- **THEN** `responses` is an empty array
- **AND** `cheaterUserIds` reflects any cheats already recorded for `q44` (possibly empty)

#### Scenario: displayName falls back to userId when user record missing

- **GIVEN** `answers.json` contains an entry with `userId: "U999"` for question `q45`
- **AND** `users.json` has no record for `U999`
- **WHEN** `get_question_history` is called with `questionId: "q45"`
- **THEN** the corresponding entry in `responses` has `displayName: "U999"`

#### Scenario: Unknown questionId returns an error

- **WHEN** `get_question_history` is called with a `questionId` that does not appear in `questions.json`
- **THEN** the tool returns a structured error indicating the question was not found
- **AND** the response contains no answer-key, `cheaterUserIds`, or `responses` fields

#### Scenario: Tool is gated to admin

- **WHEN** a session's user has role below `admin`
- **THEN** `get_question_history` is absent from the session's MCP catalog
