## 1. Schema

- [x] 1.1 Add `batchId?: string` to the `TriviaQuestion` interface in `src/plugins/trivia/core/types.ts`. Place it adjacent to `postedAt` / `processedAt`; document it in a short comment as the UUID stamped by `post_questions` per call, shared by every fresh item in that call.
- [x] 1.2 Run `npx tsc --noEmit` to confirm no downstream type errors. Any call site that constructs a `TriviaQuestion` literal should compile fine since the field is optional.

## 2. post_questions: stamp batchId

- [x] 2.1 In `src/plugins/trivia/tools/questions/postQuestions.ts`, generate `const batchId = crypto.randomUUID()` once at the top of the handler, after the `requireWritableGame` and `slackDeps.isAvailable` short-circuits.
- [x] 2.2 In the per-item `scoped.updateQuestion(...)` call (the one that writes `postedAt` and `messageLink`), include `batchId` alongside the existing fields. This branch is reached only for fresh items (the idempotency branch returns earlier with the already-stored ts/permalink and does not touch the row).
- [x] 2.3 Confirm idempotency: a re-run with an already-posted item should NOT call `updateQuestion` for that item, so its existing `batchId` (which may be `undefined` for legacy rows) is preserved. No code change required here — verify by reading the existing branch.
- [x] 2.4 Update the tool's `DESCRIPTION` string to mention that posts within one call share a single internal `batchId` for reveal-time grouping. Keep the wording short — Claude does not need to inspect or pass this value.

## 3. post_questions tests

- [x] 3.1 Locate the post_questions tests (likely `src/plugins/trivia/tools/questions/postQuestions.test.ts`). Add a test: "stamps a shared batchId on every fresh item in one call" — seed two unposted questions, call post_questions with both, assert both rows on disk carry the same non-empty UUID `batchId`.
- [x] 3.2 Add a test: "idempotent-skipped item keeps its original batchId" — seed `Q1` with `postedAt` already set and `batchId: "preexisting-batch"`, seed `Q2` fresh, call post_questions with both, assert `Q1.batchId === "preexisting-batch"` and `Q2.batchId !== "preexisting-batch"`.
- [x] 3.3 Add a test: "batchId is independent across separate calls" — seed two batches via two separate calls, assert they end up with two different batchId values.
- [x] 3.4 Add a test: "when every item is idempotent-skipped, no batchId mutation occurs" — both items have `postedAt` and `batchId` set, call post_questions, assert no row changed.
- [x] 3.5 Run `node --import tsx --test src/plugins/trivia/tools/questions/postQuestions.test.ts` and confirm all tests pass.

## 4. process_reveal_answers: select oldest batch

- [x] 4.1 In `src/plugins/trivia/tools/reveal/processRevealAnswers.ts`, replace `selectOldestPending(questions)` with a new helper `selectOldestPendingBatch(questions)` that returns `TriviaQuestion[]`. Algorithm:
   - Filter pending: `q.postedAt !== undefined && q.processedAt === undefined`.
   - Group by `batchId`. For `batchId === undefined`, key each row by its `id` so two undefined-batchId rows form two separate singleton groups.
   - For each group, compute `minPostedAt = Math.min(...group.map(q => q.postedAt ?? Infinity))`.
   - Sort groups by `minPostedAt` ascending, then by group key ascending for ties.
   - Return the first group's questions, sorted by `postedAt` ascending.
   - Return `[]` if the pending set is empty.
- [x] 4.2 Update the call site in `tool.handler` to use the new helper. The downstream `for (const question of targets)` loop already handles N>1 — no further changes to the processing loop required.
- [x] 4.3 Update the tool's `DESCRIPTION` string: replace the "DEFAULT BEHAVIOR" paragraph to say "processes EVERY question belonging to the OLDEST pending BATCH (grouped by `batchId`; questions without a `batchId` are each their own singleton batch)". Keep the rest of the description (reprocess mode, payload shape, season status) unchanged.
- [x] 4.4 No changes to `processOneTarget`, `computeSeasonStatusAndRollover`, `computeRoundSummary`, `computeLeaderboard`, or `ensureUser`. Verify by reading — those helpers operate per-question or on already-computed reveal entries and don't care how many targets there are.

## 5. process_reveal_answers tests

- [x] 5.1 In `src/plugins/trivia/tools/reveal/processRevealAnswers.test.ts`, replace the interim test "processes ALL pending questions in oldest-first order" (added in the bug-fix commit before this change) with a test that exercises the new semantics. Add `batchId` as a field on `QuestionSeed` so tests can opt-in.
- [x] 5.2 Add test: "one batch of three pending questions reveals all three in postedAt order" — seed three questions with shared `batchId: "batch-A"` and ascending `postedAt`, call the tool, assert `reveals.length === 3`, assert each row's `processedAt` is stamped.
- [x] 5.3 Add test: "oldest batch wins when two batches are pending; younger batch stays pending" — seed batch A (two questions) with older postedAt, batch B (two questions) with newer postedAt, call the tool, assert only batch A is in `reveals` and batch B's `processedAt` is still undefined.
- [x] 5.4 Add test: "successive fires drain the backlog one batch at a time" — same as 5.3, then call the tool a second time, assert batch B is now revealed.
- [x] 5.5 Add test: "legacy pending row without batchId is treated as a singleton" — seed `Q_legacy` (no batchId) with the oldest postedAt and a batch of two fresher questions, assert only `Q_legacy` is revealed.
- [x] 5.6 Add test: "two legacy rows without batchId do not merge" — seed two undefined-batchId rows with different postedAt values, assert only the oldest one is revealed.
- [x] 5.7 Update the seed helper (or add a new variant) so `QuestionSeed` carries an optional `batchId?: string`. Default `undefined` (so existing single-question tests still pass).
- [x] 5.8 Confirm the existing "picks the oldest pending question" test (line ~108) still passes — that test seeds a single question, which is a single-element singleton batch. Behavior is unchanged.
- [x] 5.9 Confirm the reprocess-mode tests still pass — reprocess mode bypasses the batch-selection branch entirely.
- [x] 5.10 Run `node --import tsx --test src/plugins/trivia/tools/reveal/processRevealAnswers.test.ts` and confirm all tests pass.

## 6. Full validation

- [x] 6.1 Run `npx tsc --noEmit` for the whole repo — no type errors.
- [x] 6.2 Run `npm test` — all 3700+ tests pass.
- [x] 6.3 Run `npx oxlint src/plugins/trivia/tools/questions/postQuestions.ts src/plugins/trivia/tools/questions/postQuestions.test.ts src/plugins/trivia/tools/reveal/processRevealAnswers.ts src/plugins/trivia/tools/reveal/processRevealAnswers.test.ts src/plugins/trivia/core/types.ts` — 0 errors, 0 warnings.
- [x] 6.4 Run `npx oxfmt --check` on the same files — formatted correctly. If anything is flagged, run `npx oxfmt` without `--check` and re-stage.
- [x] 6.5 Run `openspec validate add-trivia-question-batch-id --strict` — clean.

## 7. Manual verification (optional, gated on access)

- [ ] 7.1 In a local dev session with seasons enabled and a multi-slot format, trigger `post_questions` for a 3-slot fire and confirm all three rows on disk carry the same `batchId`.
- [ ] 7.2 Trigger `process_reveal_answers` and confirm the returned payload has `reveals.length === 3` and Slack delivery uses the multi-question layout (per-question verdicts + round summary).
- [ ] 7.3 Verify `processedAt` is now stamped on ALL three rows.
