## Why

`revealResponses` and `judgeLeniency` are stamped onto each trivia question at post/save time and read back from the stamped value at reveal — never re-resolved from the live cascade. So once a batch is posted, editing those fields via `upsert_game`/`upsert_season` only affects FUTURE batches; there is no way to correct a mistake or apply a config change to an already-posted batch. In a real incident an admin switched `revealResponses` to `"just-correctness"` and asked to reprocess the last batch; Claude had no path, re-ran the entire reveal cron via `run_scheduled_message_now`, and falsely reported the freeform text was now hidden.

## What Changes

- Extend `compute_answers`' existing **reprocess mode** so its semantic grows from "re-derive each verdict from the question's current key" to "bring each targeted question fully in line with the current key AND current config." In reprocess mode it re-resolves the config-derived frozen fields from the live cascade and re-stamps them on each targeted question record before scoring: `revealResponses` for every question, `judgeLeniency` for freeform questions.
- **BREAKING (internal tool semantics):** lift the freeform reprocess rejection. Today reprocess returns an error for freeform ("no upstream click stream to re-derive from"). In reprocess mode, freeform now re-judges the retained `answerText` rows with the re-stamped `judgeLeniency` (reset those rows' verdicts, re-run the per-answer judge). Raw answer rows are never deleted.
- Accept a `reprocessBatchId` on `compute_answers` (alongside the existing `reprocessQuestionIds`) so an admin can target a whole posted batch without enumerating question IDs.
- No new tool, and `update_answers_block` is unchanged — it already re-renders from the now-re-stamped `revealResponses`. The admin flow stays the two atomic tools: `compute_answers` (reprocess) → `update_answers_block`.
- Add a "Correcting an already-posted batch" section to `TRIVIA_MANAGEMENT_INSTRUCTION`: config edits via `upsert_game` only affect FUTURE batches; to apply a change to a posted batch, reprocess it (`compute_answers` reprocess → `update_answers_block`); NEVER re-run the reveal cron via `run_scheduled_message_now` to apply a config change; never claim a posted batch changed unless it was actually reprocessed.

## Capabilities

### New Capabilities
<!-- none — this extends existing reveal/freeform/judge capabilities -->

### Modified Capabilities
- `trivia-reveal-processor`: reprocess mode re-resolves and re-stamps `revealResponses` (all formats) and `judgeLeniency` (freeform) from the live cascade onto each targeted question before scoring; adds `reprocessBatchId` as a batch-level target.
- `trivia-freeform-questions`: freeform reveal supports reprocess — re-judging retained `answerText` rows with the re-stamped `judgeLeniency` instead of rejecting; the previously-immutable judged verdict becomes re-derivable in reprocess mode only.
- `trivia-judge-leniency`: the stamped `judgeLeniency` is re-stamped from the current cascade when a freeform question is reprocessed; "policy in effect when posed" remains the default, with reprocess as the deliberate, explicit escape hatch.
- `trivia-management-tools`: the management instruction gains guidance for correcting an already-posted batch and the prohibition on re-running the reveal cron to apply config changes.

## Impact

- Code: `src/plugins/trivia/tools/reveal/computeAnswers.ts` (re-stamp step + `reprocessBatchId` target selection + description), `src/plugins/trivia/answerTypes/freeform.ts` (reprocess re-judge path), `src/plugins/trivia/prompts/triviaCheckInstruction.ts` (`TRIVIA_MANAGEMENT_INSTRUCTION`). Possibly `answerTypes/boolean.ts`/`choice.ts` if re-stamp lives in the shared handler flow rather than the tool.
- Tools: `compute_answers` schema (new optional `reprocessBatchId`) and reprocess semantics; `update_answers_block` unchanged.
- No data migration: existing stamped fields are simply overwritten on reprocess; never-reprocessed batches are untouched.
- Behavior: only reachable through the explicit reprocess path; default reveal (oldest pending batch) is unchanged.
