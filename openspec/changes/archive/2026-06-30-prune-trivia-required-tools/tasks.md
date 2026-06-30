## 1. Prune the required-tools constants

- [x] 1.1 In `src/plugins/trivia/domain/buildGameSpecs.ts`, change `PREP_REQUIRED_TOOLS` to `["mcp__trivia__get_ideas", "mcp__trivia__find_previous_questions"]` (drop `save_question`, `find_previous_subjects`) and update its doc comment to state the always-called-only rationale.
- [x] 1.2 Change `REVEAL_REQUIRED_TOOLS` to `["mcp__trivia__compute_answers"]` (drop `settle_question`, `update_answers_block`, `start_new_season`, `update_question`) and update its doc comment.
- [x] 1.3 Replace the single `QUESTION_REQUIRED_TOOLS` constant with a base `["mcp__trivia__get_ideas"]` plus a per-game branch: append `"mcp__trivia__post_questions"` only when `game.format?.flexible !== true`. Drop `find_previous_questions`, `find_previous_subjects`, `save_question` entirely.
- [x] 1.4 Wire the question-list branch at the question-spec push site so each game's `requiredTools` is computed from its own `game.format?.flexible`. Leave `LOCK_REQUIRED_TOOLS` unchanged.
- [x] 1.5 Add a comment at the question-list branch noting the residual gap: a season-imposed flexible format cannot be detected here (buildGameSpecs is season-independent), so `post_questions` stays required for those — acceptable until the empty-array no-op follow-up.

## 2. Update existing tests

- [x] 2.1 In `src/plugins/trivia/domain/buildGameSpecs.test.ts`, update the question-spec requiredTools assertion to expect `["mcp__trivia__get_ideas", "mcp__trivia__post_questions"]` for a non-flexible game.
- [x] 2.2 Add a test: a game with `format.flexible === true` produces a question spec whose `requiredTools` is `["mcp__trivia__get_ideas"]` (no `post_questions`).
- [x] 2.3 Update the prep-spec requiredTools assertion to expect `["mcp__trivia__get_ideas", "mcp__trivia__find_previous_questions"]` (no `save_question`, no `find_previous_subjects`). Confirm the existing "Game without prepCron emits two cron specs" test still holds (its question-spec assertion is covered by task 2.1).
- [x] 2.4 Update the reveal-spec requiredTools assertion in `buildGameSpecs.test.ts` to expect `["mcp__trivia__compute_answers"]` and exclude `settle_question`, `update_answers_block`, `start_new_season`, `update_question`. Include an assertion that the reveal list is identical whether `trivia.seasons.enabled` is `true` or `false` (covers the seasons-independence scenario in the delta spec).

## 3. Remove the dead CREATE_SCHEDULES_INSTRUCTIONS source

- [x] 3.1 Delete the `CREATE_SCHEDULES_INSTRUCTIONS` export from `src/plugins/trivia/prompts/scheduledPrompts.ts` (it is unused — no production consumer, references the unregistered `send_questions_instructions` tool; superseded by `buildGameSpecs` auto-reconcile).
- [x] 3.2 In `src/plugins/trivia/tools/seasons/seasons.test.ts`, remove the `CREATE_SCHEDULES_INSTRUCTIONS` import and the `it("CREATE_SCHEDULES references the compute + project + rollover reveal requiredTools list", ...)` test (~line 2092).
- [x] 3.3 Confirm no other file imports `CREATE_SCHEDULES_INSTRUCTIONS` (grep) before deleting, and that removing it leaves `scheduledPrompts.ts` type-clean.

## 4. Sync the drifted specs

- [x] 4.1 In the `trivia-scheduled-prompts` delta, MODIFY "requiredTools per spec" to the pruned lists (question branches on `game.format.flexible`; reveal is `[compute_answers]`) and REMOVE the "Reveal `requiredTools` includes `update_question`" requirement (the prune drops it from the gate).

## 5. Pin the invariant

- [x] 5.1 Add a guard test asserting NO trivia required-tools list (prep, question both branches, reveal, lock) contains any tool from the conditional/mutating denylist: `save_question`, `find_previous_subjects`, `settle_question`, `update_question`, `update_answers_block`, `start_new_season`.
- [x] 5.2 Add a doc comment on the `requiredTools` field of the `CronJobSpec` interface in `src/plugins/sdk.ts` (~line 226) stating the invariant: list ONLY tools called on every valid run (the gate force-calls each entry), never a conditional/mutating tool. (`CronJobSpec` is the plugin-facing spec type; the runtime `CronJob.requiredTools` in `src/cronJobs.ts` already documents the gate semantics and may cross-reference this invariant.)

## 6. Verify

- [x] 6.1 Run `npx tsc --noEmit` and confirm no type errors.
- [x] 6.2 Run `npx vitest run src/plugins/trivia/` and confirm all tests pass.
- [x] 6.3 Run `npx oxlint` and `npx oxfmt --check` on the changed files; fix/format as needed.
- [x] 6.4 Run `openspec validate prune-trivia-required-tools --strict` and confirm it passes.
