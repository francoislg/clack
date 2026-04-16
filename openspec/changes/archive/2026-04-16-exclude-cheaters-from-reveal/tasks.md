## 1. Drop `isTrue` from `find_previous_questions`

- [x] 1.1 Update `src/plugins/trivia/findPreviousQuestions.ts` so the response projects each question to `{ id, category, statement, emojis, createdAt, postedAt?, messageLink? }` (no `isTrue`).
- [x] 1.2 Update or add tests in `src/plugins/trivia/findPreviousQuestions.test.ts` (create the file if it doesn't exist) asserting that `isTrue` is absent from every returned element across category-only, text-only, both, and empty-result cases.
- [x] 1.3 Audit internal callers (`triviaCheckInstruction.ts`, `scheduledPrompts.ts` Schedule A flow) — confirm none reference `isTrue` from the tool result; adjust prompt wording only if it implies the field's presence.

## 2. Add `get_question_history` tool

- [x] 2.1 Create `src/plugins/trivia/getQuestionHistory.ts` exporting `createGetQuestionHistoryTool(data)`. Argument schema: `{ questionId: string }`. Loads questions, cheats, answers, and users in parallel; returns `{ isTrue, cheaterUserIds, responses }` with `responses` enriched via `users.json` and `displayName` falling back to `userId`.
- [x] 2.2 Return a structured error when the `questionId` is not present in `questions.json` (no `isTrue` / `cheaterUserIds` / `responses` fields in that branch).
- [x] 2.3 Make `cheaterUserIds` deduplicated (use a `Set`) and order-stable for test predictability (e.g., insertion order from `cheats.json`).
- [x] 2.4 Set the tool description to instruct Claude that cheater identities are internal; do not surface them in user-facing output unless an admin explicitly asks.
- [x] 2.5 Register the tool in `src/plugins/trivia/index.ts` at role `admin` with a Slack task-card label like `"Loading trivia question history"`.
- [x] 2.6 Create `src/plugins/trivia/getQuestionHistory.test.ts` covering: returns isTrue + grouped cheaters + grouped responses; deduplicates cheaters; isolates between questions; empty cheats / empty responses cases; missing-user `displayName` fallback; unknown `questionId` error.

## 3. Update reveal prompt — silent cheater exclusion

- [x] 3.1 Edit `PROCESS_RESPONSES_INSTRUCTIONS` in `src/plugins/trivia/scheduledPrompts.ts` to insert a step (after question discovery, before voter categorization) that resolves `questionId` via `find_previous_questions` and loads `cheaterUserIds` via `get_question_history(questionId)`.
- [x] 3.2 Edit the categorization step to instruct Claude to remove every user ID in `cheaterUserIds` from every reaction list — silently, with explicit prohibition on mentioning, alluding to, or stylistically signalling the removal in the user-facing reveal.
- [x] 3.3 Edit the `submit_answers` step to instruct Claude to exclude cheaters from the payload as well.
- [x] 3.4 Add the `questionId`-resolution fallback policy: refine keyword on no/multi match; pick most-recent `createdAt` on remaining ambiguity; empty cheater list on total failure.
- [x] 3.5 Update `src/plugins/trivia/processResponsesInstructions.ts` description string to reference the new step (without leaking implementation detail beyond what the existing description does).
- [x] 3.6 Update `src/plugins/trivia/scheduledPrompts.test.ts` (or its current file) to assert: prompt mentions `find_previous_questions` and `get_question_history`; prompt forbids surfacing cheater identities; prompt instructs cheater exclusion from `submit_answers`; prompt does not mention `save_cheating`; questionId fallback wording is present.

## 4. Update setup recipe — Schedule B `requiredTools`

- [x] 4.1 Edit `CREATE_SCHEDULES_INSTRUCTIONS` in `src/plugins/trivia/scheduledPrompts.ts` so Schedule B's `requiredTools` listing includes `mcp__trivia__find_previous_questions` and `mcp__trivia__get_question_history` alongside the existing entries.
- [x] 4.2 Update the corresponding test assertions to match the new `requiredTools` set for Schedule B.
- [x] 4.3 Confirm Schedule A's `requiredTools` is unchanged.

## 5. Verification

- [x] 5.1 Run `npx tsc` — expect zero errors.
- [x] 5.2 Run `npm run test` — expect all tests green; investigate any pre-existing red unrelated to this change.
- [x] 5.3 Run `openspec validate exclude-cheaters-from-reveal --strict` — expect "is valid".
- [x] 5.4 Manual sanity check: load `findPreviousQuestions.test.ts` output, confirm the response shape matches the spec; load `getQuestionHistory.test.ts` and confirm the response payload matches a hand-traced scenario.

## 6. Documentation / handover

- [x] 6.1 Note in the change's `proposal.md` (or commit message at `/opsx:apply` time) that admins must re-run `create_schedules_instructions` per channel to refresh existing Schedule B cron jobs; pre-existing schedules will continue to run without exclusion until refreshed.
