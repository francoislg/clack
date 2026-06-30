## MODIFIED Requirements

### Requirement: requiredTools per spec

The `buildGameSpecs` function SHALL emit `requiredTools` for each cron spec containing ONLY tools called on 100% of valid runs of that spec (the `submit_response` gate force-calls every listed tool, so a conditional tool would be forced on runs where it does not apply):

- For `<game>:question` (question-posting): `["mcp__trivia__get_ideas", "mcp__trivia__post_questions"]` when the game is NOT flexible, and `["mcp__trivia__get_ideas"]` when `game.format?.flexible === true` (a flexible fire may legitimately post zero questions). `save_question`, `find_previous_questions`, and `find_previous_subjects` SHALL NOT appear — they are skipped by some generation paths (predictions skip the dedup gate; staged-pool slots skip `save_question`; `find_previous_subjects` runs only in the image subflow).
- For `<game>:reveal` (reveal): `["mcp__trivia__compute_answers"]`. `compute_answers` is the only tool called on every reveal (including an empty batch). `update_answers_block`, `start_new_season`, `settle_question`, and `update_question` SHALL NOT appear — each is invoked by the reveal prompt only conditionally. `submit_answers` and `process_reveal_answers` SHALL NOT appear (removed/renamed).

#### Scenario: Non-flexible question spec requires get_ideas and post_questions

- **WHEN** `buildGameSpecs` produces the `main:question` spec for a non-flexible game
- **THEN** `requiredTools` equals `["mcp__trivia__get_ideas", "mcp__trivia__post_questions"]`
- **AND** it does NOT include `"mcp__trivia__save_question"` or `"mcp__trivia__find_previous_questions"`

#### Scenario: Flexible question spec omits post_questions

- **WHEN** `buildGameSpecs` produces the question spec for a game with `format.flexible === true`
- **THEN** `requiredTools` equals `["mcp__trivia__get_ideas"]`
- **AND** it does NOT include `"mcp__trivia__post_questions"`

#### Scenario: Reveal spec requires only compute_answers

- **WHEN** `buildGameSpecs` produces the `main:reveal` spec
- **THEN** `requiredTools` equals `["mcp__trivia__compute_answers"]`
- **AND** it does NOT include `"mcp__trivia__update_answers_block"`, `"mcp__trivia__start_new_season"`, `"mcp__trivia__settle_question"`, `"mcp__trivia__update_question"`, `"mcp__trivia__submit_answers"`, or `"mcp__trivia__process_reveal_answers"`
- **AND** the list is identical whether or not seasons are enabled for the game

## REMOVED Requirements

### Requirement: Reveal `requiredTools` includes `update_question`

**Reason**: `update_question` is invoked by the reveal prompt ONLY when `includeRevealInQuestions` resolves to `"yes"` (not the default). Listing it in `requiredTools` made the gate force-call it on every `"no"`-mode reveal, where the tool returns an error (it rejects when the game resolves `"no"`). Per the only-always-called invariant, a conditional tool must not be gated.

**Migration**: None. `update_question` remains a registered tool and is still called by the reveal prompt's `"yes"` branch (per `trivia-reveal-in-cards`). Only its presence in the reveal spec's `requiredTools` gate list is removed; no data or config changes.
