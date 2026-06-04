## ADDED Requirements

### Requirement: `update_answers_block` appends stored `revealBlocks` when present

When projecting a question whose record carries `revealBlocks`, `update_answers_block` SHALL render the deterministic results footer (from `answers.json`, per the question's `revealResponses`) AND append the stored `revealBlocks` directly beneath the footer, before the "See your answer" button. When a question's record has no `revealBlocks`, the projection SHALL be unchanged from its facts-only behavior. The append SHALL be deterministic and idempotent — rebuilt each time from `postedBlocks` + footer + stored `revealBlocks`, never accumulating.

#### Scenario: Card with stored blocks shows footer then narrative

- **GIVEN** a processed question whose record has `revealBlocks`
- **WHEN** `update_answers_block({ game, batchId })` projects it
- **THEN** the edited card contains the deterministic results footer, then the stored `revealBlocks`, then the "See your answer" button

#### Scenario: Card without stored blocks is unchanged

- **GIVEN** a processed question with no `revealBlocks`
- **WHEN** `update_answers_block` projects it
- **THEN** the card shows only the deterministic footer, identical to facts-only behavior

#### Scenario: Re-projection after re-authoring reconciles the narrative

- **GIVEN** a card already projected with `revealBlocks` v1, then `update_question` overwrites them with v2
- **WHEN** `update_answers_block` is re-run for the batch
- **THEN** the card shows v2 narrative beneath the re-derived footer
