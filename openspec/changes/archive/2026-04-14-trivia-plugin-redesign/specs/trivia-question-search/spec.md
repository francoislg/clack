## ADDED Requirements

### Requirement: Find previous questions tool
The system SHALL provide a `find_previous_questions` MCP tool (member role) that searches past trivia questions by category and/or statement text.

#### Scenario: Search by category
- **WHEN** `find_previous_questions` is called with `category: "Marine Biology"`
- **THEN** the tool returns all questions whose `category` matches "Marine Biology"

#### Scenario: Search by text
- **WHEN** `find_previous_questions` is called with `text: "shrimp"`
- **THEN** the tool returns all questions whose `statement` contains "shrimp" (case-insensitive)

#### Scenario: Search by both category and text
- **WHEN** `find_previous_questions` is called with `category: "Marine Biology"` and `text: "hearts"`
- **THEN** the tool returns questions matching both criteria (AND)

#### Scenario: No parameters provided
- **WHEN** `find_previous_questions` is called with neither `category` nor `text`
- **THEN** the tool returns an error indicating at least one search parameter is required

#### Scenario: No matches found
- **WHEN** `find_previous_questions` is called with criteria that match no questions
- **THEN** the tool returns an empty result set

### Requirement: save_question replaces generate_question
The system SHALL provide a `save_question` MCP tool (member role) that saves a new trivia question with fields: `category`, `statement`, `isTrue`, and `emojis`.

#### Scenario: Save a valid question
- **WHEN** `save_question` is called with a valid category, statement, isTrue, and emojis
- **THEN** the question is saved to `questions.json` with a generated ID and `createdAt` timestamp

#### Scenario: Statement too short
- **WHEN** `save_question` is called with a statement shorter than 10 characters
- **THEN** the tool returns a validation error

#### Scenario: Statement too long
- **WHEN** `save_question` is called with a statement longer than 500 characters
- **THEN** the tool returns a validation error
