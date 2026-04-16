## Why

Today the scheduled answer-reveal run categorizes every reactor — including users already caught cheating on that specific question by the `trivia-check` flow earlier in the day — so cheaters get publicly celebrated for "Nailed it!" or roasted in "Not quite!" alongside honest players, and their votes count toward stats via `submit_answers`.

Separately, the `find_previous_questions` MCP tool (member-tier, callable in any session) currently returns the question's `isTrue` field — exposing the answer key to anyone who can prompt Clack to surface past questions. There is also no admin-side way to read who cheated on a given question or what answers were submitted, blocking both the reveal-time exclusion and any future leaderboard / per-question history view.

## What Changes

- **BREAKING:** `find_previous_questions` no longer returns the question's `isTrue` field. Existing callers (`trivia-check` interactive cheating detection, Schedule A duplicate check) do not depend on it; Schedule B's reveal flow already researches truth independently.
- Add a new admin-gated MCP tool `get_question_history(questionId)` returning, for that question: `isTrue`, `cheaterUserIds: string[]`, and `responses: { userId, displayName, answer, correct }[]`.
- Update the `process_responses_instructions` prompt so Schedule B's run, after locating the question, calls `get_question_history` and **silently** drops `cheaterUserIds` from every reaction list — bot-exclusion-style — before voter categorization, the `submit_answers` payload, and the user-facing reveal. Cheaters never appear in any voter section and the reveal never mentions them.
- Update the `create_schedules_instructions` recipe so Schedule B's `requiredTools` includes both `find_previous_questions` (now needed to obtain the `questionId` from the message statement) and `get_question_history`.

## Capabilities

### New Capabilities
<!-- None — no new capabilities introduced; this change extends and constrains existing ones. -->

### Modified Capabilities
- `trivia-question-search`: `find_previous_questions` no longer returns `isTrue`; new `get_question_history` tool added (admin-gated) returning per-question answer key, cheater list, and submitted-answer history.
- `trivia-cheating-detection`: cheaters are now silently excluded from the scheduled answer-reveal flow; cheat data becomes readable (admin-only) via `get_question_history`. Detection itself is unchanged.
- `trivia-scheduled-prompts`: `process_responses_instructions` gains a silent cheater-exclusion step backed by `get_question_history`; `create_schedules_instructions` adds `find_previous_questions` and `get_question_history` to Schedule B's `requiredTools`.

## Impact

- **Code**: `src/plugins/trivia/findPreviousQuestions.ts` (drop `isTrue` from response shape), `src/plugins/trivia/getQuestionHistory.ts` (new), `src/plugins/trivia/index.ts` (register new tool, admin role), `src/plugins/trivia/scheduledPrompts.ts` (`PROCESS_RESPONSES_INSTRUCTIONS` adds exclusion step; `CREATE_SCHEDULES_INSTRUCTIONS` updates Schedule B `requiredTools`), `src/plugins/trivia/processResponsesInstructions.ts` (description tweak).
- **Tests**: `findPreviousQuestions.test.ts` (assert `isTrue` no longer present), `getQuestionHistory.test.ts` (new — covers grouping, empty cases, isolation per questionId), `scheduledPrompts.test.ts` (exclusion step + new requiredTools).
- **Data**: No schema migration. `cheats.json`, `answers.json`, `users.json`, `questions.json` are read as-is.
- **Existing schedules**: Pre-existing Schedule B cron jobs that have only the old `requiredTools` set will fall through to today's behavior (no exclusion), since neither `find_previous_questions` nor `get_question_history` will be available. Admins can re-run `create_schedules_instructions` to upgrade. Documented, not auto-migrated — consistent with the existing fat-prompt-cron policy in `trivia-scheduled-prompts`.
- **Privacy**: Closes a pre-existing leak (`isTrue` reachable via member-tier search). Cheater identities and submitted-answer history are now reachable only by admin+ sessions and the deployment owner DM (unchanged).
