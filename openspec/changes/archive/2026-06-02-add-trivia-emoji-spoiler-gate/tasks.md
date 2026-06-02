## 1. Add the gate

- [x] 1.1 Add an `EMOJI_SELECTION_GATE` constant in `src/plugins/trivia/prompts/scheduledPrompts.ts`, alongside the other shared gates, with the "apply the EMOJI SELECTION GATE (shared definition above)" invocation convention. Anchor emojis to the category; forbid emojis depicting the answer or the question's specific subject; direct fallback to a category-level/generic emoji (flag example).
- [x] 1.2 Wire the gate constant into the assembled prompt(s) so it appears once, next to the other shared-gate definitions.

## 2. Reference the gate from every path

- [x] 2.1 Fact boolean path: replace step 7 "Choose fun emojis that relate to the topic" with the gate reference.
- [x] 2.2 Fact choice path: replace the "Choose 1-4 fun emojis that relate to the topic" step with the gate reference.
- [x] 2.3 Fact freeform path: replace the "Choose 1-4 fun emojis" step with the gate reference.
- [x] 2.4 Visual choice/boolean/freeform paths: replace each "Choose 1–4 emojis" step with the gate reference (leave the adjacent `media.altText` non-spoiler wording intact).

## 3. Tests

- [x] 3.1 In `src/plugins/trivia/prompts/scheduledPrompts.test.ts` (and `.choice.`/`.visual.` siblings as appropriate), assert the EMOJI SELECTION GATE text is present once and that each generation path references it.
- [x] 3.2 Run `npx tsc`, `npx oxlint src/plugins/trivia/prompts/`, and `npm test` for the trivia prompt suite.
