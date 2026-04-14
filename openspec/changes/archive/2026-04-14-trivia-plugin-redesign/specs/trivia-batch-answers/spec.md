## ADDED Requirements

### Requirement: Batch answer submission
The system SHALL provide a `submit_answers` MCP tool (member role) that accepts a question ID, a Slack message link, a posted-at timestamp, and an array of user answers.

#### Scenario: Submit batch of answers
- **WHEN** `submit_answers` is called with `questionId`, `messageLink`, `postedAt`, and an array of 3 answers
- **THEN** all 3 answers are recorded in `answers.json` with correctness computed against the question's `isTrue` field

#### Scenario: Question not found
- **WHEN** `submit_answers` is called with a `questionId` that does not exist
- **THEN** the tool returns an error indicating the question was not found

#### Scenario: Duplicate answer for same user and question
- **WHEN** a user has already answered a question and another `submit_answers` call includes their answer for the same question
- **THEN** the duplicate answer is skipped

### Requirement: Auto-register users on answer submission
The system SHALL auto-register or update users from the answer payload. Each answer entry includes `userId` and `displayName`.

#### Scenario: New user submits answer
- **WHEN** `submit_answers` includes an answer from a user not in `users.json`
- **THEN** the user is created in `users.json` with the provided `displayName` and current timestamp as `joinedAt`

#### Scenario: Existing user submits answer
- **WHEN** `submit_answers` includes an answer from a user already in `users.json`
- **THEN** the user's `displayName` is updated to the provided value

### Requirement: Stamp question with posting metadata
The system SHALL set `postedAt` and `messageLink` on the question record when `submit_answers` is first called for that question.

#### Scenario: First submission for a question
- **WHEN** `submit_answers` is called for a question that has no `postedAt` set
- **THEN** the question record is updated with the provided `postedAt` and `messageLink`

#### Scenario: Subsequent submission for same question
- **WHEN** `submit_answers` is called for a question that already has `postedAt` set
- **THEN** the question's `postedAt` and `messageLink` are not overwritten

### Requirement: Submit answers returns per-user results
The `submit_answers` tool SHALL return correctness and updated stats for each submitted answer.

#### Scenario: Mixed correct and incorrect answers
- **WHEN** `submit_answers` is called with answers where some are correct and some are incorrect
- **THEN** the result includes per-user entries with `correct`, `totalCorrect`, `totalAnswered`, and `currentStreak`
