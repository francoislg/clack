## MODIFIED Requirements

### Requirement: Batch answer submission
The system SHALL provide a `submit_answers` MCP tool (member role) that accepts a question ID, a Slack message link, a posted-at timestamp, and an array of user answers. Each entry in the answer array SHALL include `userId` (string) and `displayName` (string), and SHALL include EITHER `answer: boolean` (for boolean questions) OR `answerIndex: number` (for choice questions) but not both. The tool SHALL determine the question's type from the stored `TriviaQuestion` record (absence of `type` field reads as `"boolean"`) and validate that each answer entry's discriminator matches the question's type. Correctness SHALL be computed as `answer === question.isTrue` for boolean questions and as `answerIndex === question.correctIndex` for choice questions.

#### Scenario: Submit batch of boolean answers
- **WHEN** `submit_answers` is called with `questionId`, `messageLink`, `postedAt`, and an array of 3 boolean answer entries (each with `answer: boolean`) for a question with `type: "boolean"` (or absent)
- **THEN** all 3 answers are recorded in `answers.json` with correctness computed against the question's `isTrue` field

#### Scenario: Submit batch of choice answers
- **WHEN** `submit_answers` is called with `questionId`, `messageLink`, `postedAt`, and an array of 3 choice answer entries (each with `answerIndex: number`) for a question with `type: "choice"` and `correctIndex: 2`
- **THEN** all 3 answers are recorded in `answers.json` with correctness computed as `answerIndex === 2`
- **AND** each stored answer record carries `answerIndex` and does NOT carry `answer`

#### Scenario: Question not found
- **WHEN** `submit_answers` is called with a `questionId` that does not exist
- **THEN** the tool returns an error indicating the question was not found

#### Scenario: Duplicate answer for same user and question
- **WHEN** a user has already answered a question and another `submit_answers` call includes their answer for the same question
- **THEN** the duplicate answer is skipped

#### Scenario: Boolean answer entry on choice question rejected
- **WHEN** `submit_answers` is called with a boolean answer entry (`answer: boolean`, no `answerIndex`) for a question with `type: "choice"`
- **THEN** the tool returns an error indicating the answer entry's shape does not match the question's type

#### Scenario: Choice answer entry on boolean question rejected
- **WHEN** `submit_answers` is called with a choice answer entry (`answerIndex: number`, no `answer`) for a question with `type: "boolean"` (or absent)
- **THEN** the tool returns an error indicating the answer entry's shape does not match the question's type

#### Scenario: answerIndex out of range rejected
- **WHEN** `submit_answers` is called with a choice answer entry whose `answerIndex` is outside `[0, question.choices.length)`
- **THEN** the tool returns an error indicating `answerIndex` is out of range

### Requirement: Submit answers returns per-user results
The `submit_answers` tool SHALL return correctness and updated stats for each submitted answer. The per-user result shape SHALL be unchanged: `{ userId, displayName, correct, skipped, totalCorrect, totalAnswered, currentStreak }`. The result SHALL NOT distinguish boolean vs choice answers — both contribute equally to `totalCorrect` and `totalAnswered`.

#### Scenario: Mixed correct and incorrect boolean answers
- **WHEN** `submit_answers` is called with boolean answer entries where some are correct and some are incorrect
- **THEN** the result includes per-user entries with `correct`, `totalCorrect`, `totalAnswered`, and `currentStreak`

#### Scenario: Mixed correct and incorrect choice answers
- **WHEN** `submit_answers` is called with choice answer entries where some are correct and some are incorrect
- **THEN** the result includes per-user entries with `correct`, `totalCorrect`, `totalAnswered`, and `currentStreak`
- **AND** correctness is computed by comparing each entry's `answerIndex` to the question's `correctIndex`

#### Scenario: Equal scoring across question types
- **GIVEN** a user has answered one boolean question correctly and one choice question correctly
- **WHEN** the user's stats are computed
- **THEN** `totalCorrect` is 2 and `totalAnswered` is 2 (no type-weighted differential)
