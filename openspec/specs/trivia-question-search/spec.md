# Trivia Question Search

## Purpose

Question creation and discovery for trivia questions, including validation, search, and storage.

## Requirements

### Requirement: Find previous questions tool

The system SHALL provide a `find_previous_questions` MCP tool (member role) that searches past trivia questions by category and/or statement text.

The tool SHALL accept an optional `season` parameter (string, optional):

- When `season` is omitted, the default SHALL be `"all"` — the tool searches across every entry in `questions.json` regardless of any `season` tag. This default ensures duplicate detection naturally spans seasons.
- When `season` is `"current"`, the tool SHALL filter `questions.json` to entries whose `season` matches the currently-active season's slug (resolved via `findCurrentSeason(state, now)`). If `findCurrentSeason` returns `null` (gap), `"current"` resolves to no matches.
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

#### Scenario: "current" during a gap returns empty

- **GIVEN** `trivia.seasons.enabled` is `true` but `findCurrentSeason(state, now)` returns `null` (timeline gap)
- **WHEN** `find_previous_questions` is called with `season: "current"`
- **THEN** the result is empty (no current season exists to match against)

### Requirement: save_question replaces generate_question

The system SHALL provide a `save_question` MCP tool (member role) that saves a new trivia question with fields: `category`, `statement`, `isTrue`, and `emojis`.

When `trivia.seasons.enabled` is `true` AND `findCurrentSeason(state, now)` returns a season, each new entry written to `questions.json` SHALL include a `season: string` field equal to that season's slug. When seasons are disabled OR `findCurrentSeason` returns `null` (gap), no `season` field is written.

Category validation reads from the currently-active season's `categories` when seasons are enabled with a current season; otherwise from `categories.json`.

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

### Requirement: Find previous questions response excludes the answer key

The `find_previous_questions` MCP tool SHALL NOT include the question's `isTrue` field in any element of its returned `questions` array, regardless of caller role. The tool SHALL return only search-safe metadata: `id`, `category`, `statement`, `emojis`, `createdAt`, and (when present on the stored record) `postedAt` and `messageLink`.

This requirement closes a pre-existing exposure where any session at the `member` tier could prompt Clack into surfacing the canonical answer key for past questions through the search tool. The tool's gating remains `member`; the response shape is what changes.

#### Scenario: Response payload omits isTrue

- **WHEN** `find_previous_questions` is invoked with any combination of valid arguments and matches at least one stored question
- **THEN** every element of the returned `questions` array is an object containing `id`, `category`, `statement`, `emojis`, `createdAt`, and (when present on the stored record) `postedAt` and `messageLink`
- **AND** no element contains an `isTrue` field

#### Scenario: Empty result is unaffected

- **WHEN** `find_previous_questions` is invoked with criteria that match no questions
- **THEN** the tool returns an empty `questions` array
- **AND** no answer-key data is returned in any other field of the response

### Requirement: Get question history tool

The Trivia plugin SHALL expose a `get_question_history` MCP tool that returns the answer key, the list of users caught cheating on the question, and the list of submitted answers, for a single question identified by `questionId`.

The tool SHALL be gated to the `admin` role. The tool SHALL accept the following arguments:

- `questionId` (string, required) — the ID of the trivia question to look up.

The tool SHALL return:

- `isTrue` (boolean) — the canonical answer key for the question as recorded by `save_question`.
- `cheaterUserIds` (string array) — the deduplicated list of `cheaterUserId` values from every `cheats.json` entry whose `questionId` matches the requested question.
- `responses` (array of objects) — every entry from `answers.json` whose `questionId` matches, projected to `{ userId, displayName, answer, correct }`. The `displayName` SHALL be looked up from `users.json`; when no user record exists, `displayName` SHALL fall back to `userId`.

The tool's description SHALL instruct Claude that cheater identities are internal — Claude MUST NOT name caught cheaters in any user-facing output unless an admin explicitly asks for the list.

#### Scenario: Returns answer key, cheaters, and responses

- **GIVEN** a question `q42` exists in `questions.json` with `isTrue: true`
- **AND** `cheats.json` contains two entries with `questionId: "q42"` and `cheaterUserId` values `"U777"` and `"U888"`, plus one entry with a different `questionId`
- **AND** `answers.json` contains three entries with `questionId: "q42"` for users `U1`, `U2`, `U777`, plus an entry for a different `questionId`
- **AND** `users.json` contains records for `U1`, `U2`, and `U777` with `displayName` fields
- **WHEN** `get_question_history` is called with `questionId: "q42"`
- **THEN** the response contains `isTrue: true`
- **AND** `cheaterUserIds` is the deduplicated set `["U777", "U888"]` (order is not significant)
- **AND** `responses` contains exactly three entries, one per `q42` answer, each with the matching `userId`, the `displayName` from `users.json`, and the recorded `answer` and `correct`
- **AND** no entries from other questions appear in any field of the response

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
- **AND** the response contains no `isTrue`, `cheaterUserIds`, or `responses` fields

#### Scenario: Tool is gated to admin

- **WHEN** a session's user has role below `admin`
- **THEN** `get_question_history` is absent from the session's MCP catalog
