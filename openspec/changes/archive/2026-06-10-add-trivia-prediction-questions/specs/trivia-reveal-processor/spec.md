## ADDED Requirements

### Requirement: `compute_answers` gates on undecided predictions

In default mode, before scoring, `compute_answers` SHALL refuse (returning `code: "UNDECIDED_PREDICTIONS"` plus the offending ids, and writing nothing) when any question in the oldest pending batch is still `resolved: false` — i.e. a prediction that has been neither answered nor invalidated via `settle_question`. This forces an explicit decision on every prediction before the batch is scored.

#### Scenario: pending prediction blocks the batch

- **WHEN** `compute_answers` runs and the batch contains a prediction with `resolved: false`
- **THEN** the tool returns `UNDECIDED_PREDICTIONS` with that question's id and scores nothing

#### Scenario: settled prediction scores normally

- **WHEN** the prediction has been answered (`settle_question` with an `outcome`)
- **THEN** `compute_answers` scores it against the stamped key and derives the verdict on any rows that were pending (`correct: undefined`) from clicks placed before settling

### Requirement: `compute_answers` renders invalidated questions at 0 points

A question carrying `invalidated: true` SHALL be surfaced in the payload's `invalidatedQuestions` array (with its `invalidatedReason`), never scored, and stamped `processedAt` so it is terminal. It SHALL NOT appear in `reveals`.

#### Scenario: invalidated question is reported, not scored

- **WHEN** `compute_answers` processes a batch containing an `invalidated` question
- **THEN** that question appears in `invalidatedQuestions`, is marked `processedAt`, and is absent from `reveals`
- **AND** its answers contribute 0 to the leaderboard

### Requirement: Invalidated cards repaint as invalidated

`update_answers_block` SHALL repaint an `invalidated` question's card into an "invalidated" state (the answer affordances removed, an "invalidated — <reason>" line appended) instead of a results footer, whether the question was invalidated before or after its reveal.

#### Scenario: invalidated card shows the invalidated state

- **WHEN** `update_answers_block` runs over a batch containing an `invalidated` question
- **THEN** that question's card is repainted with the invalidated line and no results footer
