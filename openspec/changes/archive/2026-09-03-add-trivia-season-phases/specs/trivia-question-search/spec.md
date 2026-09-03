## ADDED Requirements

### Requirement: find_previous_questions surfaces the phase stamp

`find_previous_questions` SHALL include a question record's `phase` stamp in its per-question response, alongside the existing `season` and `slot` provenance, IF AND ONLY IF the record carries one. Records written before this capability, and records written while no phase was active, SHALL be rendered exactly as before with no phase key.

This makes the resolved-at-generation phase auditable after the fact — the same reason `season`, `slot`, `points`, and `judgeLeniency` are surfaced.

#### Scenario: Phase stamp is surfaced when present

- **GIVEN** a question record stamped `phase: "gauntlet"`
- **WHEN** `find_previous_questions` returns that record
- **THEN** the entry includes `phase: "gauntlet"`

#### Scenario: Unstamped records render unchanged

- **GIVEN** a question record with no `phase` key
- **WHEN** `find_previous_questions` returns that record
- **THEN** the entry contains no `phase` key
