## ADDED Requirements

### Requirement: Question-posting prompt honors resolved `instructions` and `additionalInstructions`

The question-posting prompt SHALL document that the `get_ideas` response payload MAY include `instructions` (a single string) and `additionalInstructions` (a multi-tier labeled concatenation) fields. When either field is present in the payload, Claude SHALL honor that field's content as guidance throughout the question-generation run — applying it to phrasing, content choice, tone, and any other aspect of the generated question. When a field is absent, the prompt SHALL instruct Claude to ignore it entirely (no synthesis, no enumeration of categories as a substitute).

#### Scenario: Both fields present in get_ideas payload

- **WHEN** `get_ideas` returns both fields populated
- **THEN** the prompt SHALL instruct Claude to honor both verbatim during question composition

#### Scenario: Only one field present

- **WHEN** `get_ideas` returns only `instructions`
- **THEN** the prompt SHALL instruct Claude to honor `instructions` and to ignore the absent `additionalInstructions`

#### Scenario: Neither field present

- **WHEN** `get_ideas` returns neither field
- **THEN** the prompt SHALL behave identically to today's behavior (no behavior change relative to current question-generation flow)

### Requirement: Answer-reveal prompt honors resolved `instructions` and `additionalInstructions`

The answer-reveal prompt SHALL document that the `process_reveal_answers` response payload MAY include `instructions` and `additionalInstructions` fields on the top-level result. When either field is present, Claude SHALL honor that field's content during reveal rendering — applying it to verdict tone, voter-bucket commentary, the closer line, and the leaderboard introduction. When a field is absent, the prompt SHALL instruct Claude to ignore it entirely.

#### Scenario: Both fields present in process_reveal_answers payload

- **WHEN** `process_reveal_answers` returns both fields populated
- **THEN** the reveal prompt SHALL instruct Claude to honor both verbatim during reveal rendering

#### Scenario: Neither field present

- **WHEN** `process_reveal_answers` returns neither field
- **THEN** the reveal prompt SHALL behave identically to today's behavior (no behavior change relative to current reveal flow)

### Requirement: Other scheduled trivia prompts are unaffected

The opener, season-finale, and any other scheduled trivia prompt SHALL NOT receive `instructions` or `additionalInstructions` content. Their behavior SHALL remain identical to today's behavior.

#### Scenario: Season-finale fire does not consume the axes

- **WHEN** a reveal fire is also the season's last fire and the finale section is rendered
- **THEN** the finale prompt SHALL NOT reference `instructions` or `additionalInstructions` — only the existing finale contract applies
