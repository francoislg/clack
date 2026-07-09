## ADDED Requirements

### Requirement: Prompts and runbooks reference the renamed tools

Every scheduled prompt and admin runbook the trivia plugin ships (`scheduledPrompts.ts`, `triviaCheckInstruction.ts`, and any instruction content registered via the SDK) SHALL reference the card projector as `refresh_question_cards` and the narrative persist tool as `set_reveal_narrative`. No shipped prompt or instruction SHALL reference the retired names `update_answers_block` or `update_question`.

#### Scenario: No stale tool names in shipped prompt content

- **WHEN** the shipped prompt and instruction sources are searched for `update_answers_block` and `update_question`
- **THEN** no occurrence is found, and the reveal/prep/check prompts name `refresh_question_cards` and `set_reveal_narrative` at the corresponding steps

### Requirement: Reveal prompt teaches the invalidation recovery flow

The reveal prompt's prediction-decision step SHALL explicitly document that invalidation is reversible: when instructing Claude to invalidate an undecided prediction (outcome unavailable or unresolvable), it SHALL include that an admin can later reverse the decision with `settle_question({ reopen: true })`. The admin runbook (`triviaCheckInstruction.ts`) SHALL document the full recovery sequence for a wrongly-invalidated question that had already been revealed:

1. `settle_question({ reopen: true })` — clear the invalidation;
2. `refresh_question_cards([id])` — restore the card to its live/locked look;
3. once the outcome is known (predictions): `settle_question({ outcome })`;
4. `compute_answers({ reprocessQuestionIds: [id] })` — re-derive the verdicts;
5. `refresh_question_cards([id])` — repaint the card with the corrected results footer.

For a question invalidated BEFORE its reveal, the runbook SHALL note that steps 4–5 are unnecessary: after reopen + repaint (steps 1–2) it reveals normally with its batch through the scheduled reveal flow.

#### Scenario: Invalidation guidance mentions reversibility

- **WHEN** the reveal prompt instructs invalidating an undecided prediction
- **THEN** the same instruction notes the decision is reversible via `settle_question({ reopen: true })`

#### Scenario: Runbook documents the recovery sequence

- **WHEN** an admin asks how to recover a wrongly-invalidated question
- **THEN** the runbook content walks the reopen → repaint → settle → reprocess → repaint sequence, distinguishing the already-revealed case (reprocess) from the not-yet-revealed case (normal scheduled reveal)
