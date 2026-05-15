## MODIFIED Requirements

### Requirement: Find previous questions tool

The system SHALL provide a `find_previous_questions` MCP tool (member role) that searches past trivia questions by category and/or statement text.

The tool SHALL accept an optional `season` parameter (string, optional):

- When `season` is omitted, the default SHALL be `"all"` — the tool searches across every entry in `questions.json` regardless of any `season` tag. This default ensures duplicate detection naturally spans seasons.
- When `season` is `"current"`, the tool SHALL filter `questions.json` to entries whose `season` matches `seasons.json#current`.
- When `season` is any other string, the tool SHALL filter to entries whose `season` exactly matches the provided value.

When `trivia.seasons.enabled` is `false`, the `season` parameter SHALL be silently ignored and the tool SHALL search across the entire `questions.json` (legacy behavior).

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

#### Scenario: Default season is "all" — duplicate detection spans seasons

- **GIVEN** `trivia.seasons.enabled` is `true` with seasons `"spring-2026"` (history) and `"summer-2026"` (current)
- **AND** a question with text "Mount Everest is..." exists in `questions.json` tagged `season: "spring-2026"`
- **WHEN** `find_previous_questions` is called with `text: "Everest"` and no `season` argument
- **THEN** the spring-2026 question is included in the result set

#### Scenario: Explicit season filter scopes the search

- **GIVEN** `questions.json` contains entries tagged `"spring-2026"` and `"summer-2026"`
- **WHEN** `find_previous_questions` is called with `text: "..."` and `season: "summer-2026"`
- **THEN** only entries tagged `"summer-2026"` are eligible for matching

#### Scenario: Seasons disabled — season parameter ignored

- **GIVEN** `trivia.seasons.enabled` is `false`
- **WHEN** `find_previous_questions` is called with `season: "anything"`
- **THEN** the search proceeds across the entire `questions.json` without any season filter

### Requirement: save_question replaces generate_question

The system SHALL provide a `save_question` MCP tool (member role) that saves a new trivia question with fields: `category`, `statement`, `isTrue`, and `emojis`.

When `trivia.seasons.enabled` is `true`, each new entry written to `questions.json` SHALL include a `season: string` field equal to `seasons.json#current` at the moment of write. When `seasons.enabled` is `false`, no `season` field SHALL be written on new question entries.

#### Scenario: Save a valid question

- **WHEN** `save_question` is called with a valid category, statement, isTrue, and emojis
- **THEN** the question is saved to `questions.json` with a generated ID and `createdAt` timestamp

#### Scenario: Statement too short

- **WHEN** `save_question` is called with a statement shorter than 10 characters
- **THEN** the tool returns a validation error

#### Scenario: Statement too long

- **WHEN** `save_question` is called with a statement longer than 500 characters
- **THEN** the tool returns a validation error

#### Scenario: New question carries the current season tag when seasons are enabled

- **GIVEN** `trivia.seasons.enabled` is `true` and `seasons.json#current` is `"august-2026"`
- **WHEN** `save_question` is called with valid arguments
- **THEN** the new entry in `questions.json` includes `season: "august-2026"`

#### Scenario: New question carries no season tag when seasons are disabled

- **GIVEN** `trivia.seasons.enabled` is `false`
- **WHEN** `save_question` is called with valid arguments
- **THEN** the new entry in `questions.json` contains no `season` field
