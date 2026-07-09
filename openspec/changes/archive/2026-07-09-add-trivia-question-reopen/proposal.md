# Proposal: add-trivia-question-reopen

## Why

Invalidating a trivia question is currently a one-way door: no tool clears `invalidated`, and `settle_question`'s answer path stamps a key without clearing the flag — so both `compute_answers` and the card projector keep treating the question as dead forever. A real incident proved it: a prediction posted in advance was invalidated at reveal time because its event hadn't happened yet, and the only recovery was hand-editing `questions.json` on the server. Two adjacent defects make recovery riskier still: the card projector paints the results footer on any keyed question (leaking answers on not-yet-revealed cards), and reprocess mode stamps `processedAt` on live questions (silently removing them from the pending reveal flow).

## What Changes

- **`settle_question` gains a `reopen` mode** — the inverse of invalidate. Clears `invalidated`/`invalidatedReason`; for a keyless question also restores `resolved: false` and clears `resolvedAt`/`resolvedOutcome` (a keyed question stays settled). `processedAt` is deliberately preserved, so the scheduled reveal cadence is undisturbed and an already-revealed question stays eligible for `compute_answers` reprocess. Returns a `refreshHint` like every other mutator. Raw answer rows are untouched (verdicts were already cleared at invalidation; reprocess re-derives them).
- **Card projection becomes state-complete.** The card-projection tool paints whichever state the record is in — invalidated, revealed (keyed + `processedAt` set), locked (`answerLocked`, not processed), or live (buttons + roster restored) — instead of only the two terminal states. This closes the answer-leak: a keyed but unprocessed question repaints as live/locked, never with the results footer.
- **BREAKING (internal rename): `update_answers_block` → `refresh_question_cards`.** The old name described an implementation detail; the new one describes the behavior. All prompt references and `refreshHint` builders follow.
- **BREAKING (internal rename): `update_question` → `set_reveal_narrative`.** The tool only ever wrote `revealBlocks`; the general-sounding name promised a question editor that doesn't exist and misled operators. No behavior change.
- **Reprocess guard in `compute_answers`:** reprocess mode refuses targets whose `processedAt` is unset (per-id error; nothing to RE-process), so reprocessing can no longer leak answers or steal questions from the pending reveal flow.
- **`settle_question` description drift fixed:** the tool description references `skip: true`/`skippedReason`/`skipped: true` — none exist (schema is `invalidate`/`invalidatedReason`; record field is `invalidated`). Rewritten to match reality and document the new reopen mode.
- **Scheduled prompts updated:** reveal/prep prompts reference the renamed tools and the reveal prompt documents the recovery flow (reopen → settle → reprocess → repaint) so wrong invalidations are fixable conversationally.

Both renames are internal-only (tool names are consumed by Claude prompts and admin conversations, not by external systems or persisted state); no migration is needed.

## Capabilities

### New Capabilities

None — every piece extends an existing capability.

### Modified Capabilities

- `trivia-prediction-questions`: `settle_question` gains the `reopen` mode (third verb alongside answer/invalidate) and its tool description is corrected to the real arg/field names.
- `trivia-card-projection`: the projector is renamed `refresh_question_cards` and becomes state-complete (invalidated / revealed / locked / live), with the keyed-but-unprocessed leak closed.
- `trivia-reveal-processor`: `compute_answers` reprocess mode requires targets to already carry `processedAt`.
- `trivia-reveal-in-cards`: the narrative persist tool is renamed `set_reveal_narrative` (behavior unchanged).
- `trivia-scheduled-prompts`: prompts reference the renamed tools; the reveal prompt teaches the recovery flow.

## Impact

- **Code:** `src/plugins/trivia/tools/reveal/settleQuestion.ts`, `updateAnswersBlock.ts` (renamed), `computeAnswers.ts`, `src/plugins/trivia/tools/questions/updateQuestion.ts` (renamed), `src/plugins/trivia/revealCards/editCard.ts` (live/locked projections, likely sharing the rebuild used by `tools/lock/applyLock.ts`), `src/plugins/trivia/core/refreshHint.ts`, `src/plugins/trivia/prompts/scheduledPrompts.ts`, `src/plugins/trivia/index.ts` (registration labels), i18n label keys.
- **Data:** no schema change — reopen only deletes existing optional fields from question records (`updateQuestion`'s merge + `JSON.stringify` already drops `undefined`). No migration.
- **Prompts/docs:** every prompt or instruction that names `update_answers_block` / `update_question` is updated to the new names.
- **Tests:** existing suites for the renamed tools move with them; new coverage for reopen semantics (keyed vs keyless), state-complete projection (four states), and the reprocess guard.
