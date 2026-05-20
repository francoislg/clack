## 1. Tool argument

- [x] 1.1 In `src/plugins/trivia/tools/questions/findPreviousQuestions.ts`, add an optional `recentBatchFromNow` field to the Zod input schema: `z.number().int().positive().optional()`. The `.describe()` text MUST state explicitly that `1` is the most recently posted batch as of the current moment, `2` is the one before that, etc., and that it ranks batches by their `max(postedAt)` anchored to NOW (not the season's timeline, not an absolute index).
- [x] 1.2 Update the tool's top-level description string to mention the new arg in one short sentence using the same "as of now" phrasing.

## 2. Selection logic

- [x] 2.1 In the same file, after the existing per-question filter loop (which applies `category`, `text`, and `season`) and BEFORE the result is returned, branch on `args.recentBatchFromNow`. If absent, behavior is unchanged.
- [x] 2.2 When present, take the already-filtered list and exclude any entry where `postedAt === undefined` or `batchId === undefined`. Legacy unbatched rows must not participate in the recency ranking.
- [x] 2.3 Group the survivors by `batchId` into a `Map<string, TriviaQuestion[]>`.
- [x] 2.4 Build a `[batchId, maxPostedAt][]` and sort descending by `maxPostedAt`, ties broken by `batchId` ascending.
- [x] 2.5 Select the entry at index `args.recentBatchFromNow - 1`. If out of range, return an empty result.
- [x] 2.6 Sort the selected group's questions by `postedAt` ascending, apply the existing `limit` cap, and map through `toSearchResult(...)` before returning.

## 3. "At least one search parameter" rule

- [x] 3.1 ~~Locate the existing "no search criteria" branch~~ — N/A: that branch does not exist in code. The existing spec scenario was aspirational, not implemented. Dropped the scenario from the spec delta; no code change needed. `recentBatchFromNow` alone works because the tool is already permissive.
- [x] 3.2 ~~Re-read the resulting branch~~ — N/A, see 3.1.

## 4. Tests

- [x] 4.1 In `src/plugins/trivia/tools/questions/findPreviousQuestions.test.ts`, add a small helper that seeds questions with explicit `batchId` and `postedAt` so the tests can shape the batch landscape per scenario.
- [x] 4.2 Add test: "recentBatchFromNow=1 returns every question in the most recent batch, ordered by postedAt asc" — seed 3 batches with distinct UUIDs, assert the call returns exactly the newest batch.
- [x] 4.3 Add test: "recentBatchFromNow=2 returns the second-most-recent batch" — same seed, assert the prior batch is returned.
- [x] 4.4 Add test: "recentBatchFromNow alone is a valid search" — no `category`/`text`/`season`, assert no validation error.
- [x] 4.5 Add test: "recentBatchFromNow exceeding available batches returns an empty result, not an error".
- [x] 4.6 Add test: "legacy rows without batchId are excluded from the recent-batch view" — seed one batched question (older) and one legacy posted row (newer, no batchId); assert `recentBatchFromNow=1` returns the batched one only.
- [x] 4.7 Add test: "filters compose with recentBatchFromNow before grouping (T3 has Y matches)" — match the spec scenario where the most recent batch still has questions after the category filter.
- [x] 4.8 Add test: "filters can eliminate a batch from the ranking" — T3 has no Y matches, T2 does; `recentBatchFromNow=1` + `category: "Y"` returns T2.
- [x] 4.9 Add test: "recentBatchFromNow=0 is rejected with a validation error".
- [x] 4.10 Add test: "recentBatchFromNow=-1 is rejected with a validation error".
- [x] 4.11 Add test: "limit caps the per-batch result" — seed a batch with 5 questions, `recentBatchFromNow: 1, limit: 2`, assert exactly 2 returned (the 2 oldest by postedAt).
- [x] 4.12 Run `node --import tsx --test src/plugins/trivia/tools/questions/findPreviousQuestions.test.ts` and confirm all tests pass.

## 5. Full validation

- [x] 5.1 Run `npx tsc --noEmit` — no type errors.
- [x] 5.2 Run `npm test` — all tests pass.
- [x] 5.3 Run `npx oxlint src/plugins/trivia/tools/questions/findPreviousQuestions.ts src/plugins/trivia/tools/questions/findPreviousQuestions.test.ts` — 0 errors, 0 warnings.
- [x] 5.4 Run `npx oxfmt --check` on the same files — formatted correctly. If anything is flagged, run `npx oxfmt` without `--check` and re-stage.
- [x] 5.5 Run `openspec validate add-find-questions-recent-batch --strict` — clean.

## 6. Manual verification (optional, gated on access)

- [ ] 6.1 In a session with posted batches present, call `find_previous_questions` with `recentBatchFromNow: 1` and confirm the returned IDs match the most recently posted batch's IDs.
- [ ] 6.2 Repeat with `recentBatchFromNow: 2` and confirm the prior batch is returned.
- [ ] 6.3 Repeat with `recentBatchFromNow: 1, category: "<a category present in the latest batch>"` and confirm only matching questions from that batch come back.
