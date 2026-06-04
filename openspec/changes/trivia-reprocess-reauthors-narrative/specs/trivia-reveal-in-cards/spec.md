## ADDED Requirements

### Requirement: Reprocessing an already-posted batch re-authors the per-card narrative

When an admin reprocesses an already-posted batch (`compute_answers` reprocess mode followed by `update_answers_block`), the reprocess runbook SHALL instruct Claude to re-author each reprocessed question's per-card narrative via `update_question` BEFORE calling `update_answers_block`, exactly as the fresh-reveal flow does — but ONLY when `includeRevealInQuestions` resolves to `"yes"` for the game. The re-authored narrative SHALL conform to the question's now-current `revealResponses` mode (e.g. it MUST NOT quote a player's typed answer that the current mode hides) and to the verdicts re-derived by the reprocess (e.g. it MUST NOT assert a player was correct when the re-judge flipped that verdict to incorrect).

When `includeRevealInQuestions` resolves to `"no"`, the runbook SHALL NOT call `update_question` during reprocess (cards stay facts-only), matching the fresh-reveal flow.

This is a prompt-only requirement: it adds an authoring step to the runbook in `triviaCheckInstruction.ts` ("Correcting an already-posted batch") and introduces no new tool, payload field, or code path.

#### Scenario: revealResponses dropped to just-correctness then reprocessed

- **GIVEN** a posted freeform batch whose cards were revealed with `revealResponses: "yes"` and whose narrative quotes a player's typed answer ("you said Swiss")
- **AND** the game resolves `includeRevealInQuestions: "yes"`
- **WHEN** an admin changes `revealResponses` to `"just-correctness"` and reprocesses the batch
- **THEN** the runbook instructs Claude to call `update_question` for each reprocessed card before `update_answers_block`
- **AND** the re-authored narrative no longer quotes the player's typed answer

#### Scenario: Reprocess with includeRevealInQuestions no does not author narrative

- **GIVEN** a posted batch on a game that resolves `includeRevealInQuestions: "no"`
- **WHEN** an admin reprocesses the batch
- **THEN** the runbook does NOT instruct Claude to call `update_question`
- **AND** the cards remain facts-only after `update_answers_block`
