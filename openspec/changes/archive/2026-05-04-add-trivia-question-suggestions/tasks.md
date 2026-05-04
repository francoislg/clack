## 1. Reshape `get_ideas`

- [x] 1.1 In `src/plugins/trivia/getIdeas.ts`, restructure the result so category-pool stats sit under `categories: { ideas, total, excluded }`.
- [x] 1.2 Add a `suggestedAnswer` field computed as `Math.random() < 0.5`.
- [x] 1.3 Add a `suggestedDifficulty` field computed by a single `Math.random()` with thresholds `< 0.30 → "Easy"`, `< 0.90 → "Medium"`, else `"Hard"`.
- [x] 1.4 Update the tool's `description` string to mention that it also returns a suggested answer and difficulty hint.

## 2. Tests for `get_ideas`

- [x] 2.1 Add tests in `src/plugins/trivia/trivia.test.ts` (or a new `getIdeas.test.ts` co-located with the tool) covering: result shape, `categories.total` matches pool size, `categories.excluded` matches recently-used count, pool-smaller-than-5 still returns `suggestedAnswer` and `suggestedDifficulty`.
- [x] 2.2 Add a sanity test that `suggestedAnswer` takes both values across many calls (stub `Math.random` or assert distribution over a seeded loop).
- [x] 2.3 Add a sanity test that `suggestedDifficulty` produces all three buckets and that the boundaries match 0.30 / 0.90 (deterministic via stubbed `Math.random`).

## 3. Update the question-flow prompt

- [x] 3.1 In `src/plugins/trivia/scheduledPrompts.ts`, edit `QUESTION_FLOW_STEPS` step 1 to mention that `get_ideas` also returns `suggestedAnswer` and `suggestedDifficulty`.
- [x] 3.2 Edit step 2 to instruct Claude to aim research at the bucket named by `suggestedDifficulty` and spell out the bucket-to-1–10 mapping (Easy 4–6, Medium 7–8, Hard 9–10).
- [x] 3.3 Rewrite step 3 to honor `suggestedAnswer` (true → keep TRUE; false → modify a key detail to make FALSE). Remove the "randomly decide" wording.
- [x] 3.4 Edit step 6 (difficulty gate) so the target range is the one named by `suggestedDifficulty`; keep the ≤3/10 reject rule unchanged.

## 4. Update prompt tests

- [x] 4.1 In `src/plugins/trivia/scheduledPrompts.test.ts`, update existing assertions that match the old step-3 wording.
- [x] 4.2 Add assertions that the returned `SEND_QUESTIONS_INSTRUCTIONS` text references `suggestedAnswer` and `suggestedDifficulty` and includes the bucket-to-1–10 mapping.
- [x] 4.3 Add an assertion that the text does NOT contain "randomly decide" or equivalent random-truth-value wording.

## 5. Validate and verify

- [x] 5.1 Run `npx tsc --noEmit` to type-check.
- [x] 5.2 Run `npm run test`.
- [x] 5.3 Run `openspec validate add-trivia-question-suggestions --strict`.
- [x] 5.4 If `graphify-out/` is present, run `graphify update .` to refresh the knowledge graph.
