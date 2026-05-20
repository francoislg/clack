## 1. Tool input schema + handler

- [x] 1.1 Add optional `appendToPreviousBatch: z.boolean().optional()` argument to the `post_questions` Zod schema in `src/plugins/trivia/tools/questions/postQuestions.ts`, with a `.describe(...)` that names its purpose and references the retry-of-failed-items scenario.
- [x] 1.2 Extract a helper `resolvePreviousBatchId(questions: TriviaQuestion[]): { batchId: string; processedIds: string[] } | null` in the same file (not exported) that groups questions by `batchId`, picks the group with the largest `max(postedAt)`, and returns its `batchId` plus the ids within it that already have `processedAt` set. Returns `null` when no question carries a `batchId`.
- [x] 1.3 In the handler, when `appendToPreviousBatch === true`, call the helper BEFORE the per-item loop. If it returns `null`, return a top-level `errorResult` naming the game and stating no previous batch exists. If it returns a record whose `processedIds` is non-empty, return a top-level `errorResult` naming the resolved `batchId` and at least one `processedIds[0]` and stating that appending would resurrect an already-revealed batch.
- [x] 1.4 When `appendToPreviousBatch === true` resolves cleanly (non-empty batchId, empty processedIds), use the resolved `batchId` for stamping fresh items instead of calling `crypto.randomUUID()`. Idempotent-skip semantics stay untouched.
- [x] 1.5 When `appendToPreviousBatch` is absent or `false`, behavior is unchanged: mint one fresh UUID per call (the existing line stays).
- [x] 1.6 Update the tool's `DESCRIPTION` string to document the new arg, the default, and the two failure modes (no prior batch / batch already revealed).

## 2. Tool unit tests

- [x] 2.1 Add to `src/plugins/trivia/tools/questions/postQuestions.test.ts`: "append: reuses the most-recent batch's UUID" — seed Q1+Q2 with `batchId: "batch-AAA"` and no `processedAt`; seed fresh Q3; call with `appendToPreviousBatch: true`; assert Q3.batchId === `"batch-AAA"`.
- [x] 2.2 Add: "append: default behavior preserved when flag is absent or false" — seed Q1 with `batch-AAA`; seed fresh Q2; call once without the flag, once with `false`; assert both stamp Q2 with a NEW UUID.
- [x] 2.3 Add: "append: most-recent batch is the group with the largest max(postedAt)" — seed two batches per the scenario (batch-OLD covers postedAt 100/200, batch-NEW covers 150/300); call with append flag; assert the resolved batchId is `"batch-NEW"`.
- [x] 2.4 Add: "append: multiple fresh items share the resolved batchId" — confirm both items in a multi-item append call land on the same `batchId`.
- [x] 2.5 Add: "append: rejected when the previous batch has any processedAt" — seed Q1 with `processedAt: 5000` and `batchId: "batch-AAA"`; call append; assert `result.isError === true`, the error text mentions `batch-AAA` and `Q1`, NO Slack post was made, Q3's record is untouched on disk.
- [x] 2.6 Add: "append: rejected when no previous batch exists" — empty `questions.json` or only legacy rows without `batchId`; call append; assert `result.isError === true`, error mentions the game, no Slack call, no disk mutation.
- [x] 2.7 Add: "append: short-circuits before idempotent-skip" — make every item idempotent-skippable AND make the previous batch already-revealed; assert the call returns the append-flag error (not a `results` array of idempotent skips).

## 3. Prompt update

- [x] 3.1 In `src/plugins/trivia/prompts/scheduledPrompts.ts`, append a "RETRY ON PARTIAL FAILURE" sub-clause to step 10 of `SEND_QUESTIONS_INSTRUCTIONS` (inside the `=== FORMAT & POST (BOTH FLOWS, BOTH PATHS) ===` section so it applies to single-question AND multi-slot flows). The clause MUST literally name `appendToPreviousBatch: true`, MUST tie it to the "one or more `results[].ok === false`" scenario, and MUST instruct Claude to send a follow-up `post_questions` call with ONLY the failed items.
- [x] 3.2 The clause MUST NOT instruct Claude to thread a raw `batchId` string. State this as an explicit negative if needed for clarity.

## 4. Prompt tests

- [x] 4.1 Add to `src/plugins/trivia/prompts/scheduledPrompts.test.ts` (inside the `SEND_QUESTIONS_INSTRUCTIONS` describe block) a test asserting `/appendToPreviousBatch:\s*true/` is present in the prompt string.
- [x] 4.2 Add an assertion that the prompt mentions retrying failed items (e.g. `/retry.*failed items/i`) in proximity to the `appendToPreviousBatch` mention.
- [x] 4.3 Add a NEGATIVE assertion: the prompt must NOT instruct Claude to pass a literal `batchId:` argument (i.e. `.doesNotMatch(/batchId:\s*["']/)` to catch both `batchId: "..."` and `batchId: '...'`).

## 5. Verify end-to-end

- [x] 5.1 Run `npx tsc --noEmit` and confirm zero errors.
- [x] 5.2 Run `npm test` and confirm all suites pass, including the new tool and prompt scenarios.
- [x] 5.3 Run `openspec validate add-post-questions-append-flag --strict` and resolve any reported issues.
