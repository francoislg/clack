## ADDED Requirements

### Requirement: Reveal flow edits each processed question's original message

After `process_reveal_answers` successfully processes a question (`processedAt` stamped, voter buckets built), the reveal flow SHALL invoke the static reveal-card edit for that question, passing the question record and the built reveal entry. The edit SHALL run once per successfully-processed question, including in reprocess mode. A failed or skipped edit SHALL NOT affect the tool's returned payload, leaderboard, or season status.

#### Scenario: Each revealed question triggers a card edit

- **WHEN** a batch of questions is processed at reveal
- **THEN** the reveal-card edit is invoked once for each question whose processing succeeded

#### Scenario: A question whose processing errored is not edited

- **WHEN** processing a question returns an error outcome
- **THEN** no reveal-card edit is invoked for that question
- **AND** the error is still accumulated into the tool's per-id errors list

#### Scenario: Reprocess repaints the card

- **WHEN** a boolean or choice question is reprocessed
- **THEN** the reveal-card edit is invoked again with the re-derived voter buckets

#### Scenario: Card edit failure does not break the payload

- **WHEN** the reveal-card edit for a question fails
- **THEN** the tool still returns its reveals, leaderboard, and (when enabled) season status
