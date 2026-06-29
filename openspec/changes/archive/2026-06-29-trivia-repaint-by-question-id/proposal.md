## Why

Admins routinely ask Clack to "update the cards" and it fails with `no questions found for batchId "<GUID>"` / `"<timestamp>"`. Root cause: `update_answers_block` is keyed on `batchId`, a UUID minted by `post_questions` and surfaced exactly once — in `compute_answers`'s reveal-time payload. No read tool exposes it, so in any follow-up request Claude no longer holds it and fabricates one. The question `id`, by contrast, is returned by every read path (`find_previous_questions.id`, `compute_answers` `reveals[].questionId`). Keying the repaint on the id Claude can always read removes the guessing entirely.

## What Changes

- **Principle — `batchId` is internal-only.** It remains the on-disk join key that `post_questions` stamps and `compute_answers` groups by, but it SHALL NOT be surfaced to Claude as a value to read or pass. Claude operates on question **ids** (which every read path already returns) plus **derived batch facts** (below). No tool result hands Claude a raw `batchId`.
- **BREAKING (internal tool contract):** `update_answers_block` takes `{ game, questionIds: string[] }` instead of `{ game, batchId, questionIds? }`. It repaints exactly the named cards, each rebuilt independently from its own `postedBlocks`; unnamed siblings are untouched. This subsumes today's optional `questionIds` subset filter and the mid-window-replay special case (repaint one live-batch card without revealing its siblings is now just "name one id").
- **Read tools expose batch *facts*, not the id.** `find_previous_questions` returns, per posted row, derived booleans instead of the opaque handle: `batchPending` (the question's batch has not been revealed — still live, votes open) and `batchIsLatest` (the question belongs to the game's most recently posted batch). This lets Clack reason about replay eligibility (mid-window needs `batchPending`), top-up (`appendToPreviousBatch` targets the latest pending batch), and "fix the last batch" without ever handling a GUID.
- `compute_answers`'s renderer contract points the caller at `reveals.map(r => r.questionId)`; it no longer surfaces `batchId` in its payload. `reprocessBatchId` remains a valid internal input but is no longer a documented Claude flow — reprocessing a known set is driven by `reprocessQuestionIds` (Claude sources the ids from `find_previous_questions`).
- **Uniform `refreshHint`** on every content-mutating tool (`settle_question`, `override_answer`, `remove_cheat`): each result carries the exact `update_answers_block(game, questionIds: ["<id>"])` call to make next. This is the single common repaint path, named identically everywhere — replacing the prose-only hints that exist today.
- **No auto-repaint** (deliberately rejected): auto-repainting inside the scoring mutators over-fires `chat.update` on chained edits (e.g. three `override_answer` calls on one card) and can render pre-rescore state (`remove_cheat` needs a `compute_answers` pass to score the un-excluded answer). The uniform hint makes repaint fire once, at chain end, correctly.
- Instructions migrated `batchId` → `questionIds`: the reveal flow (`scheduledPrompts.ts`) and the admin override/replay/reprocess flows (`triviaCheckInstruction.ts`). The reprocess flow uses `reprocessQuestionIds`.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `trivia-card-projection`: `update_answers_block`'s input changes from `{ game, batchId }` to `{ game, questionIds: string[] }` (required, ≥1); selection is per-id (name exactly the cards to repaint) rather than batch-keyed; and a new requirement that content-mutating tools surface a uniform `refreshHint` naming the exact repaint call.
- `trivia-question-search`: `find_previous_questions` rows expose derived `batchPending` / `batchIsLatest` booleans (computed per the row's game) and SHALL NOT expose the raw `batchId`.

(`trivia-reveal-processor` is touched in code — `compute_answers` drops `batchId` from its payload and points the renderer at `reveals[].questionId` — but no requirement changes: the spec's payload type never declared `batchId`, the renderer-contract wording lives in the tool description, and `reprocessBatchId` selection is unchanged. So no delta spec.)

## Impact

- `src/plugins/trivia/tools/reveal/updateAnswersBlock.ts` — schema (`batchId` → `questionIds`), per-id selection, return shape (`notFound` replaces `batchId` echo), description. Drops the `selectBatch` import (kept for `compute_answers`).
- `src/plugins/trivia/tools/questions/findPreviousQuestions.ts` — `toSearchResult` computes + emits `batchPending` / `batchIsLatest`; never emits `batchId`.
- `src/plugins/trivia/tools/reveal/computeAnswers.ts` — drop `batchId` from the payload; renderer-contract wording in the description.
- `src/plugins/trivia/tools/reveal/{settleQuestion,overrideAnswer}.ts` and `src/plugins/trivia/tools/answers/removeCheat.ts` — uniform `refreshHint` result field.
- `src/plugins/trivia/prompts/{scheduledPrompts,triviaCheckInstruction}.ts` — `batchId` → `questionIds` across the reveal, override, replay, and reprocess flows.
- Tests: `updateAnswersBlock.test.ts`, `findPreviousQuestions.test.ts`, `reveal.integration.test.ts`, `replayQuestion.integration.test.ts`, `computeAnswers.test.ts`, `scheduledPrompts.test.ts`, plus mutator-tool tests for the `refreshHint` field.
- No data migration: stored records are unchanged (`batchId` still stamped and used internally by `compute_answers`).
