## 1. `update_answers_block` keyed on `questionIds`

- [x] 1.1 Replace the `{ game, batchId, questionIds? }` schema with `{ game, questionIds: string[] }` (non-empty, `.min(1)`); rewrite the tool description to teach the per-id handle (from `reveals[].questionId` or a mutator's `refreshHint`) and drop all `batchId` language, matching the delta spec's "Selection SHALL be by question `id`" wording.
- [x] 1.2 Replace `selectBatch(...)` selection with per-id selection: load `questions.json`, pick rows whose `id ∈ questionIds` in `postedAt` order, collect unmatched ids into `notFound`; error only when ALL ids are unmatched. Remove the `selectBatch` import (leave `batchSelection.ts` for `compute_answers`).
- [x] 1.3 Replace the `batchId` echo in the result with `notFound` (only when non-empty); keep `edited` / `errors`.
- [x] 1.4 Migrate `updateAnswersBlock.test.ts` to `questionIds` (each call names its ids); add cases for unknown-id-reported (`{edited,notFound}`), all-unknown-error, single-card-only-leaves-siblings, duplicate-ids-deduped, and empty-array-rejected; assert a PROJECTION failure carries `errors: [{questionId,error}]` (a `chat.update` failure stays swallowed/logged, not in `errors`); preserve the existing idempotency / re-score-reconcile / partial-failure-non-abort / `revealBlocks` scenarios (migrated to the new arg); drop the obsolete batch-handle / subset-filter tests.

## 2. `compute_answers` renderer contract

- [x] 2.1 Drop `batchId` from the `ProcessRevealResult` payload; update the description's renderer contract to "call `update_answers_block` with `reveals.map(r => r.questionId)`" and steer reprocess to `reprocessQuestionIds`. Leave `reprocessBatchId` input + internal batch grouping untouched.
- [x] 2.2 Update `computeAnswers.test.ts` assertions that read `result.batchId` to use `reveals[].questionId`.

## 3. Read tools expose batch facts, not the id

- [x] 3.1 In `findPreviousQuestions.ts`, reuse the same per-game `batchId` grouping the `recentBatchFromNow` path already builds to derive `batchPending` (no sibling has `processedAt`) and `batchIsLatest` (this `batchId` has the greatest max `postedAt` in its game) for each posted row; emit both on the row via `toSearchResult`. Never emit `batchId`. Omit both for rows without a `batchId`.
- [x] 3.2 Add `findPreviousQuestions.test.ts` cases: live latest batch → `pending:true,isLatest:true`; older revealed batch → both false; per-game computation in a cross-game scan; staged row omits both; no row ever carries `batchId`.

## 4. Uniform `refreshHint` on content mutators

- [x] 4.1 `settle_question` — add a `refreshHint` field (`update_answers_block(game, questionIds: ["<id>"])`) to the invalidate result and to the re-settle (`override: true`) result of an already-revealed question (the latter follows its `compute_answers` reprocess step); omit it when answering a still-pending, not-yet-revealed prediction (no posted card). Update the description prose to match.
- [x] 4.2 `override_answer` — replace the prose `refreshHint` with the standardized `update_answers_block(game, questionIds: ["<id>"])` form (after the reprocess step).
- [x] 4.3 `remove_cheat` — add the same `refreshHint` field to its success result.
- [x] 4.4 Add/extend each tool's test to assert the `refreshHint` names `update_answers_block` with the acted-on question id inside a `questionIds` array (and never a `batchId`).

## 5. Instruction migration (`batchId` → `questionIds`)

- [x] 5.1 `scheduledPrompts.ts` — reveal flow: step-1 note and step-2 call use `reveals[].questionId`; the cron prompt names `questionIds`. Update `scheduledPrompts.test.ts` regex (`update_answers_block({ game, questionIds: ... })`).
- [x] 5.2 `triviaCheckInstruction.ts` — override Cases 1–3 (≈ lines 157/165/171) and replay Cases A/B (≈ lines 180/188) and the predictions-reprocess step (≈ line 359) use `update_answers_block(game, questionIds: ["<id>"])`; remove the mid-window "the `questionIds` filter is REQUIRED here / get the `batchId` from the question record" sentence at ≈ line 180 (it is now the natural form). The reprocess flow (≈ line 355) uses `reprocessQuestionIds` (sourced from `find_previous_questions`), not a batch handle.
- [x] 5.3 Migrate `replayQuestion.integration.test.ts` and `reveal.integration.test.ts` call sites to `questionIds`.

## 6. Verify

- [x] 6.1 `npx tsc` clean; `npx oxlint` + `npx oxfmt --check` clean on touched files.
- [x] 6.2 `npm test` green (full suite — pre-commit runs it).
- [x] 6.3 `openspec validate trivia-repaint-by-question-id --strict` passes.
- [x] 6.4 Confirm no `batchId` reaches any Claude-facing surface: grep the touched files for `batchId` and verify every remaining hit is internal (record field, `compute_answers` grouping, `reprocessBatchId` input) — none in a tool result returned to Claude, a tool description, or an instruction prompt.
- [x] 6.5 Drop the `wip-repaint-handle` git stash once this implementation supersedes it (`git stash drop` the matching entry) — it was a pre-spec sketch of the same `update_answers_block` edit and is no longer needed.
