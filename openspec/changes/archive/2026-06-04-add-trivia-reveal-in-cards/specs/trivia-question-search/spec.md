## ADDED Requirements

### Requirement: `find_previous_questions` exposes `revealBlocks` only on opt-in targeted lookups

`find_previous_questions` SHALL expose a question's stored `revealBlocks` ONLY when the caller opts in — either by requesting specific question ids OR by passing an `includeRevealBlocks: true` flag — and SHALL NOT include `revealBlocks` in its default/broad list response. Because `revealBlocks` narrative reveals the answer, the field SHALL be returned only for questions that have already been revealed (`processedAt` set); for not-yet-revealed questions the field SHALL be omitted even when opted in, preserving the existing "response excludes the answer key" guarantee for live questions.

This serves the re-emit/repair path: when a revealed card was deleted, Claude can fetch the already-authored `revealBlocks` and re-emit them via `submit_response` without regenerating the narrative. It is distinct from `update_answers_block`, which re-projects to the original message.

#### Scenario: Default list omits revealBlocks

- **WHEN** `find_previous_questions` is called without the opt-in
- **THEN** no entry carries a `revealBlocks` field

#### Scenario: Targeted opt-in returns revealBlocks for a revealed question

- **GIVEN** a revealed question `Q1` (`processedAt` set) whose record has `revealBlocks`
- **WHEN** `find_previous_questions` targets `Q1` with the opt-in
- **THEN** the `Q1` entry includes its `revealBlocks`

#### Scenario: Opt-in still withholds blocks for a live question

- **GIVEN** a posted-but-not-revealed question `Q2` (`processedAt` absent)
- **WHEN** `find_previous_questions` targets `Q2` with `includeRevealBlocks: true`
- **THEN** the `Q2` entry has no `revealBlocks` field
