## 1. Rewrite the generation-path ADMIN GUIDANCE clause

- [x] 1.1 In `src/plugins/trivia/prompts/scheduledPrompts.ts` (~line 47), remove the "and any other aspect of the question you generate" phrasing from the `instructions` bullet; scope it to phrasing/content/tone.
- [x] 1.2 Add the independent-block framing and the explicit-intent decision test (structural change only on explicit add/remove/replace/reorder; otherwise preserve structure and apply to named block content/tone) covering both `instructions` and `additionalInstructions`.
- [x] 1.3 State the answer-button floor: buttons appended by `post_questions` are tool-owned and not removable by instruction.

## 2. Rewrite the reveal-path admin-instruction clause

- [x] 2.1 In `scheduledPrompts.ts` (~line 638), apply the same explicit-intent decision test to the reveal `instructions` / `additionalInstructions` bullets.
- [x] 2.2 State that the leaderboard `table` arg is omitted when an instruction explicitly asks for its removal, and that the answer-button floor applies.

## 3. Tighten block labels for unambiguous targeting

- [x] 3.1 In the FOUR-BLOCK question-card layout (~line 455), reword block #2's label so "preamble" / "opener" / "warm-up" map unambiguously to the warm-up patter `section`.

## 4. Verify

- [x] 4.1 Run `npx tsc` to confirm no type/compile regressions from the prompt-constant edits.
- [x] 4.2 Re-read the rendered generation and reveal prompts and confirm both carry the explicit-intent rule, the block-independence framing, and the button floor.
- [x] 4.3 Run `openspec validate preserve-trivia-structure-on-instructions --strict`.
