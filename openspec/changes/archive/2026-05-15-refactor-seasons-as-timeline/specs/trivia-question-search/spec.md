## MODIFIED Requirements

### Requirement: Find previous questions tool

The system SHALL provide a `find_previous_questions` MCP tool (member role) that searches past trivia questions by category and/or statement text.

The tool SHALL accept an optional `season` parameter (string):

- When `season` is omitted, the default SHALL be `"all"` (unchanged — duplicate detection spans seasons by default).
- When `season` is `"current"`, the tool SHALL filter `questions.json` to entries whose `season` matches the currently-active season's slug (resolved via `findCurrentSeason(state, now)`). If `findCurrentSeason` returns `null` (gap), `"current"` resolves to no matches.
- When `season` is any other string, the tool SHALL filter to entries whose `season` exactly matches that value.

When `trivia.seasons.enabled` is `false`, the `season` argument is silently ignored.

All other behavior is preserved (case-insensitive matching, answer-key redaction, pagination, etc.).

#### Scenario: Default season "all" still spans the timeline

- **GIVEN** `trivia.seasons.enabled` is `true` and questions exist tagged with both `"spring-2026"` (past) and `"may-2026"` (current)
- **WHEN** `find_previous_questions(text: "...")` is called with no `season` argument
- **THEN** matching questions from both seasons are included in the result

#### Scenario: "current" resolves via findCurrentSeason

- **GIVEN** the currently-active season's slug is `"may-2026"`
- **WHEN** `find_previous_questions(text: "...", season: "current")` is called
- **THEN** only questions tagged `"may-2026"` are eligible for matching

#### Scenario: "current" during a gap returns empty

- **GIVEN** `findCurrentSeason` returns `null`
- **WHEN** `find_previous_questions(text: "...", season: "current")` is called
- **THEN** the result is empty (no entries match a null current season)

### Requirement: save_question replaces generate_question

The system SHALL provide a `save_question` MCP tool (member role) that saves a new trivia question with fields: `category`, `statement`, `isTrue`, and `emojis`.

When `trivia.seasons.enabled` is `true` AND `findCurrentSeason(state, now)` returns a season, each new entry written to `questions.json` SHALL include a `season: string` field equal to that season's slug. When seasons are disabled OR `findCurrentSeason` returns `null` (gap), no `season` field is written.

Category validation reads from the currently-active season's `categories` (per the `trivia-categories` capability) when seasons are enabled with a current season; otherwise from `categories.json`.

#### Scenario: New question is tagged with the active season's slug

- **GIVEN** the currently-active season's slug is `"may-2026"`
- **WHEN** `save_question` is called with valid arguments
- **THEN** the new entry includes `season: "may-2026"`

#### Scenario: New question during a gap is untagged

- **GIVEN** `findCurrentSeason` returns `null`
- **WHEN** `save_question` is called with valid arguments
- **THEN** the new entry contains no `season` field
