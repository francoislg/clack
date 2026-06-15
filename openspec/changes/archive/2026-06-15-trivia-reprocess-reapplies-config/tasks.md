## 1. compute_answers reprocess: target + re-stamp

- [x] 1.1 In `src/plugins/trivia/tools/reveal/computeAnswers.ts`, add `reprocessBatchId: z.string().optional()` to the tool's Zod input schema (alongside `reprocessQuestionIds`). Enter reprocess mode when `reprocessQuestionIds` is non-empty OR `reprocessBatchId` is a non-empty string.
- [x] 1.2 Extract the batch-selection logic currently inline at `updateAnswersBlock.ts:128-133` (`selectBatch` — match shared `batchId`, fall back to the single legacy row whose `id` equals the handle when no `batchId` matches, sort `postedAt`-ascending) into a shared module (e.g. `src/plugins/trivia/tools/reveal/batchSelection.ts`) and import it from BOTH `update_answers_block` and `compute_answers`, so the two select identically. Build the reprocess target set as the UNION of `reprocessQuestionIds` and the `reprocessBatchId` expansion.
- [x] 1.3 In reprocess mode, BEFORE scoring each targeted question, rebuild that question's cascade context from its STAMPED `slot.index` + `season` (the same identity `post_questions` used to stamp it) via `buildCascadeContext`, re-resolve `revealResponses` (all formats) and `judgeLeniency` (freeform only) with `resolveCascade`, and re-stamp them on the question record via `scoped.updateQuestion`. Isolate per question: if context-rebuild/resolution throws for one question, record a per-id error and skip it (do NOT clobber its stamped value), mirroring the existing `perIdErrors` pattern.
- [x] 1.4 Update the `compute_answers` `DESCRIPTION` to document the widened reprocess semantic (re-stamps current config AND re-derives key), the new `reprocessBatchId` target + union rule, and freeform support.

## 2. Freeform re-judge in reprocess mode

- [x] 2.1 Remove the `isReprocessMode` early-return rejection in `freeform.ts` `processReveal` (currently `freeform.ts:163-169`).
- [x] 2.2 When `deps.isReprocessMode`, select ALL retained rows for judging (default mode keeps the `correct === undefined` filter); the per-row verdict write overwrites the prior verdict and always sets `judgeReason` so a reasonless re-judge clears a stale reason. Never modify/delete `answerText`; keep the exact-match pre-check short-circuit. On retry-exhaustion the prior verdict stays intact and `processedAt` is not stamped (reported as before). No separate reset pass / extra write.
- [x] 2.3 Mode-gate the selection: default mode (neither reprocess arg set) `processReveal` judges only `correct === undefined` rows and never touches an already-judged verdict.

## 3. Management instruction guidance

- [x] 3.1 Add a "Correcting an already-posted batch" section to `TRIVIA_MANAGEMENT_INSTRUCTION` (`triviaCheckInstruction.ts`), placed after the "Flag shadowed edits" section. Content: (a) config edits via `upsert_game`/`upsert_season`/`set_workspace_config` (including `revealResponses`/`judgeLeniency`) affect FUTURE batches only; (b) to apply a change to a posted batch, reprocess it — `compute_answers` with `reprocessBatchId` (or `reprocessQuestionIds`) then `update_answers_block` with the returned `batchId`; (c) NEVER use `run_scheduled_message_now` to apply a config change to a posted batch; (d) never claim a posted batch changed unless it was actually reprocessed.

## 4. Tests

- [x] 4.1 `computeAnswers` unit tests (mock cascade/data boundary), one case per reveal-processor delta scenario: (a) boolean verdicts re-derived both directions; (b) reprocess never deletes rows; (c) reprocess re-stamps `revealResponses` from the current cascade (stamped `"yes"` → cascade `"just-correctness"` → record + payload reflect it); (d) re-stamp is a no-op when resolved value equals stamped value; (e) `reprocessBatchId` expands to the whole batch in `postedAt` order; (f) union when both `reprocessQuestionIds` + `reprocessBatchId` given; (g) `reprocessBatchId` matching nothing yields no targets / per-id-style empty result.
- [x] 4.2a Freeform reprocess test: a previously-judged row is reset (`correct → undefined`, `judgeReason` cleared) and re-judged under the re-stamped `judgeLeniency` via the normal judge path; `answerText` unchanged. Mock `askClaude`.
- [x] 4.2b Freeform default-mode test: already-judged rows are skipped; only `correct === undefined` rows are judged; mixed batch (one `correct:true`, one `correct:false`, one `undefined`) judges only the undefined row.
- [x] 4.2c Freeform reprocess judge-failure test: a reprocessed row whose judge call exhausts retries is left pending (`correct` stays `undefined`), `processedAt` is not stamped, and the failure is reported.
- [x] 4.3 Replace the existing "Reprocess refuses freeform questions" unit test in the `computeAnswers` suite with the re-judge behavior; keep the boolean/choice re-derive + never-delete tests passing.
- [x] 4.4 Add a test (e.g. `triviaCheckInstruction.test.ts`) asserting `TRIVIA_MANAGEMENT_INSTRUCTION` includes the substrings: `"Correcting an already-posted batch"`, `"compute_answers"`, a reprocess target (`"reprocessBatchId"` or `"reprocessQuestionIds"`), `"update_answers_block"`, `"run_scheduled_message_now"` (the prohibition), and the future-batches-only principle.

## 5. Verify

- [x] 5.1 `npx tsc` clean; `npm test` green; `npx oxlint` + `npx oxfmt --check` on touched files.
- [x] 5.2 `openspec validate trivia-reprocess-reapplies-config --strict` passes.
