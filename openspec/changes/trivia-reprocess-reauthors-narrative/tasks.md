## 1. Update the reprocess runbook

- [x] 1.1 In `src/plugins/trivia/prompts/triviaCheckInstruction.ts`, under "Correcting an already-posted batch", insert a narrative-authoring step between the `compute_answers` reprocess call and the `update_answers_block` call: when `includeRevealInQuestions` resolves to `"yes"`, re-author each reprocessed card's narrative via `update_question` (conforming to the now-current `revealResponses` and re-derived verdicts) BEFORE `update_answers_block`; when `"no"`, skip it. Renumber the runbook steps accordingly.
- [x] 1.2 Reference the fresh-flow "AUTHOR PER-CARD NARRATIVE" branch (`scheduledPrompts.ts:775`) for wording parity so the two paths stay consistent.

## 2. Verify

- [x] 2.1 Run `npx tsc` (no type changes expected) and the trivia test suite to confirm nothing regressed.
- [x] 2.2 Run `openspec validate trivia-reprocess-reauthors-narrative --strict`.
