## ADDED Requirements

### Requirement: Reveal prompt authors per-card narrative when `includeRevealInQuestions` is yes

`PROCESS_REVEAL_INSTRUCTIONS` SHALL branch on the payload's `includeRevealInQuestions`. When `"yes"`, for EACH revealed question the prompt SHALL instruct Claude to call `update_question({ game, questionId, revealBlocks })` with that question's narrative (verdict, WHY, the fun-fact comment, and — when nobody got it — the expanded "nobody cracked it" teaching) BEFORE `update_answers_block` projects the cards, so each card shows facts + that narrative. When `"no"`, the prompt SHALL NOT author card narrative (today's flow). The `revealBlocks` SHALL contain only narrative, never the deterministic facts (which `update_answers_block` renders from `answers.json`).

#### Scenario: Prompt describes the yes branch

- **WHEN** `PROCESS_REVEAL_INSTRUCTIONS` is inspected
- **THEN** the `"yes"` branch instructs a per-question `update_question` call carrying the narrative, before `update_answers_block`
- **AND** the `"no"` branch does not author card narrative

### Requirement: Reveal `requiredTools` includes `update_question`

`buildGameSpecs` SHALL include `"mcp__trivia__update_question"` in the reveal job's `requiredTools` so the `"yes"` branch can author per-card narrative. Its presence is harmless in `"no"` mode (the prompt does not call it).

#### Scenario: Reveal spec lists update_question

- **WHEN** `buildGameSpecs` produces the reveal spec
- **THEN** `requiredTools` includes `"mcp__trivia__update_question"`
