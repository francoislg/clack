# trivia-answering-strategy (delta)

## ADDED Requirements

### Requirement: Strategy selection is question-aware and stamp-driven

The plugin SHALL select the active `AnsweringStrategy` per question via a single selector: a question stamped `answeringType: "byTeam"` gets `ByTeamAnswering` constructed over the question's stamped roster; any other question (including all legacy records with no stamp) gets `IndividualAnswering`. Consumers SHALL obtain the strategy through the selector only — no call site may branch on `answeringType` itself.

#### Scenario: Legacy question selects individual

- **WHEN** a question record with no `answeringType` field is processed by any consumer (click, roster, reveal, scoring)
- **THEN** the selector returns `IndividualAnswering` and behavior is identical to the pre-teams-answering system

#### Scenario: Stamped byTeam question selects the team strategy everywhere

- **WHEN** a question stamped `answeringType: "byTeam"` is processed by the click installer, the roster renderer, and the reveal pipeline
- **THEN** all three obtain `ByTeamAnswering` from the selector, built from the SAME stamped roster
