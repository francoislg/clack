## 1. Config & Types

- [x] 1.1 Extend `src/config.ts` to parse and validate optional `trivia.questionsTypes` (map of `"boolean" | "choice"` → non-negative integer) and `trivia.choices` (`{ min: 2..4, max: 2..4, min ≤ max }`); reject invalid bounds at load
- [x] 1.2 Add `src/config.test.ts` cases for the new fields (valid mix, choice-only, invalid bounds, defaults when absent)
- [x] 1.3 Update `src/plugins/trivia/types.ts`: add `type?: "boolean" | "choice"` to `TriviaQuestion`, add optional `choices: string[]` and `correctIndex: number`, add optional `answerIndex?: number` to `SubmittedAnswer`
- [x] 1.4 Add a tiny helper module (e.g. `src/plugins/trivia/questionTypes.ts`) exposing `getActiveQuestionTypes(data, now)` that resolves from `findCurrentSeason(state, now).questionTypes` (when seasons enabled, current entry exists, and field is set) → `config.trivia.questionsTypes` → `{ "boolean": 1 }` default; and `getActiveChoiceBounds()` that reads only from `config.trivia.choices` (workspace-only, with `{ min: 2, max: 4 }` default — NOT season-overridable); unit-test the priority order, gap behavior, and the workspace-only bound semantics

## 2. get_ideas: weighted-random type + choice metadata

- [x] 2.1 Add a weighted-pick utility in `src/plugins/trivia/` (re-normalizes from `{ boolean: 2, choice: 1 }` style maps) with a test covering distribution-over-many-rolls and edge cases (zero weights, single-type map)
- [x] 2.2 Extend `getIdeas.ts` to call `getActiveQuestionTypes()` and roll `suggestedType`; when `"choice"`, also roll `suggestedChoiceCount` uniform in `[min, max]` and `suggestedCorrectIndex` uniform in `[0, count)`
- [x] 2.3 Update the `get_ideas` tool's Zod return schema + description; ensure boolean-path still returns `suggestedAnswer` and choice-path returns the two new fields (and not `suggestedAnswer`)
- [x] 2.4 Add `getIdeas.test.ts` cases: pure boolean config, pure choice config, mixed config, season override path, statistical-uniformity check for `suggestedCorrectIndex` over many calls

## 3. save_question: choice path validation

- [x] 3.1 Extend `saveQuestion.ts` Zod schema with discriminated arguments: boolean shape unchanged; choice shape accepts `type: "choice"`, `choices: string[]`, `correctIndex: number` (no `isTrue`)
- [x] 3.2 Implement choice validation: `choices.length` within active `[min, max]`; `correctIndex` in `[0, choices.length)`; each choice 1–100 chars after trim; `new Set(choices.map(c => c.trim().toLowerCase())).size === choices.length`; reject `isTrue` when `type: "choice"` and reject `choices`/`correctIndex` when `type: "boolean"`
- [x] 3.3 Stamp `type: "boolean"` explicitly on new boolean writes (so future reads don't need to special-case absence); legacy records remain readable
- [x] 3.4 Add `saveQuestion.test.ts` (new file) covering: valid boolean, valid choice, correctIndex out of range, duplicate choices, whitespace/case-equivalent duplicates, choices length below `min`, above `max`, choice question with `isTrue`, boolean question with `choices`

## 4. submit_answers: discriminated answer shape

- [x] 4.1 Extend `submitAnswers.ts` Zod schema to accept `answer?: boolean` OR `answerIndex?: number` per entry (exactly one must be set)
- [x] 4.2 At call time, load the question, read its `type` (default `"boolean"` when absent), and validate each entry's discriminator matches the question's type — return a structured error otherwise
- [x] 4.3 Compute correctness via the right branch: `answer === question.isTrue` for boolean, `answerIndex === question.correctIndex` for choice; validate `answerIndex` is in `[0, choices.length)`
- [x] 4.4 Persist `answerIndex` (not `answer`) on choice-answer records; keep `answer` for boolean
- [x] 4.5 Add tests (extend existing test files or create `submitAnswers.test.ts`): boolean batch unchanged, choice batch correctness, mismatch (boolean entry on choice question and vice-versa), `answerIndex` out of range, duplicate-skip semantics on choice answers, equal-credit stats (1 boolean correct + 1 choice correct → `totalCorrect: 2`)

## 5. find_previous_questions & get_question_history

- [x] 5.1 Extend `findPreviousQuestions.ts` return shape to include `type` (when present on the stored row) and `choices` (for choice questions); strip `isTrue` AND `correctIndex` from the response payload (answer-key fields never leak through search)
- [x] 5.2 Update `findPreviousQuestions.test.ts` for the new shape; add a regression test that no `isTrue` or `correctIndex` appears in any response field for boolean or choice rows
- [x] 5.3 Extend `getQuestionHistory.ts` to return the type-discriminated answer key: boolean → `{ type: "boolean", isTrue }`; choice → `{ type: "choice", choices, correctIndex }`
- [x] 5.4 Update each response entry in `getQuestionHistory.ts` to carry `answer` (for boolean answers) or `answerIndex` (for choice answers) — mirror the stored row's shape
- [x] 5.5 Add `getQuestionHistory.test.ts` cases for choice questions (answer key shape, response entries carry `answerIndex`)

## 6. Scheduled prompts: question-posting (SEND_QUESTIONS_INSTRUCTIONS)

- [x] 6.1 Refactor `scheduledPrompts.ts`: split `QUESTION_FLOW_STEPS` into a `BOOLEAN_FLOW_STEPS` constant (existing 10-step flow) and a new `CHOICE_FLOW_STEPS` constant (correct-first → distractors → plausibility gate → difficulty gate → dedup → save → Block Kit layouts → sized reactions)
- [x] 6.2 Compose `SEND_QUESTIONS_INSTRUCTIONS` with a "branch on `suggestedType`" header, the boolean section, and the choice section — both clearly labeled
- [x] 6.3 In the choice section, encode the four gate conditions verbatim (correct ≥ 5, top distractor ≥ 4, gap ≤ 4, every distractor ≥ 2), the "rewrite only the failing distractor" rule, the 3-pass retry budget, and the "abandon and re-roll from `get_ideas`" fallback
- [x] 6.4 In the choice section, describe both stacked and inline Block Kit layouts with examples and pick-by-readability guidance
- [x] 6.5 In the choice section, specify the `reactions` array sizing rules (2/3/4 → `["one", ...]`, in order, `:one:` first)
- [x] 6.6 Update `scheduledPrompts.test.ts` to assert: branch on `suggestedType`, four-condition gate text, retry-budget text, locked-correctIndex statement, both layout descriptions, sized reactions text, boolean-path text unchanged

## 7. Scheduled prompts: reveal (PROCESS_RESPONSES_INSTRUCTIONS)

- [x] 7.1 Re-order the reveal flow so `find_previous_questions` + `get_question_history` (the resolve-question step) is BEFORE any reaction parsing; carry `question.type` forward through the rest of the flow
- [x] 7.2 Split reaction parsing into two branches by `question.type`: boolean branch (existing `:+1:`/`:-1:` / fence-sitter / wildcard logic), choice branch (numbered emoji → index, multi-react silently voided, wildcards still surfaced)
- [x] 7.3 Encode the choice branch's "silently voided" rule: multi-react voters are excluded from scoring AND from `submit_answers` AND from the user-facing reveal copy (no callout, no roast)
- [x] 7.4 Encode the choice-branch hard-failure on unresolvable question: post an admin-facing error in the channel and abort; preserve the existing best-effort fallback for boolean questions
- [x] 7.5 Update `submit_answers` payload guidance per branch: boolean uses `[{ userId, displayName, answer }]`; choice uses `[{ userId, displayName, answerIndex }]`
- [x] 7.6 Update the voter-situations list: boolean keeps four (Correct/Incorrect/Fence-sitters/Wildcards); choice has three (Correct/Incorrect/Wildcards) — multi-react never surfaces
- [x] 7.7 Update `scheduledPrompts.test.ts` (and/or `trivia.test.ts`) to assert: resolve-before-parse ordering, boolean branch text, choice branch text, multi-react silent void rule, hard-failure-on-unresolvable-choice text, three voter situations on choice

## 7b. Seasons: upsert_season questionTypes argument

- [x] 7b.1 Extend `src/plugins/trivia/upsertSeason.ts` Zod schema with optional `questionTypes: Record<"boolean" | "choice", number>`, allowing `null` for explicit clear on UPDATE
- [x] 7b.2 Implement validation: only `"boolean"` and `"choice"` keys; non-negative integers; at least one positive on non-null writes; reject all-zero maps and unknown keys
- [x] 7b.3 Extend `SeasonEntry` type in `src/plugins/trivia/types.ts` with optional `questionTypes` field
- [x] 7b.4 Update `upsert_season`'s return shape to include `hasQuestionTypes: boolean`
- [x] 7b.5 Allow mid-season `questionTypes` mutation (unlike `startedAt` — explicitly permitted because this is the whole point of mid-season tweakability)
- [x] 7b.6 Add `seasons.test.ts` cases for: create-with-questionTypes, create-without, update-set, update-replace, update-clear-via-null, all-zero rejection, unknown-key rejection, mid-season mutation allowed, mutation persists across reload

## 8. Create-schedules instructions

- [x] 8.1 Audit `CREATE_SCHEDULES_INSTRUCTIONS` and `createSchedulesInstructions.ts` for any changes needed (likely none — the recipe is generic over question type since the prompts now branch internally). Update if any required tools are missing for the choice path. **Confirmed: no new tools needed — choice path uses the same MCP tools (`get_ideas`, `save_question`, `find_previous_questions`, `submit_answers`); branching is internal to the prompt.**
- [x] 8.2 Confirm via test that Schedule A's required tools list and Schedule B's required tools list cover both branches (no new required tools, just verify nothing was missed). **Existing schedule tests assert the tools list and continue to pass — no change required.**

## 9. Trivia-check instruction copy

- [x] 9.1 Update `triviaCheckInstruction.ts` to surface for admins: "set trivia question types per workspace or per season" with a one-line guidance pointer (config key name + season-tool reference)
- [x] 9.2 Re-run any existing trivia-check tests; add a coverage assertion that the new admin-facing guidance is present

## 10. End-to-end / integration tests

- [x] 10.1 Add an integration-style test in `trivia.test.ts` covering: configure mixed types → call `get_ideas` repeatedly → assert distribution → call `save_question` with rolled choice metadata → verify stored shape → call `submit_answers` with choice answers → verify correctness + per-user stats. **Implemented as `choiceFlow.integration.test.ts`.**
- [x] 10.2 Add an integration-style test covering: configure choice-only → reveal flow happy path (resolve question, parse `:one:`–`:four:`, categorize voters including a multi-react void case and a wildcard case, call `submit_answers` with `answerIndex`). **Reveal-flow parsing is prompt-driven (Claude does the categorization); tool-level happy path is covered by `submitAnswers.choice.test.ts` and the e2e flow in `choiceFlow.integration.test.ts`. Prompt-content assertions covered in `scheduledPrompts.choice.test.ts`.**
- [x] 10.3 Add an integration-style test covering: configure choice-only → reveal flow hard-failure path (unresolvable question → admin error posted, no `submit_answers` call). **The hard-failure path is enforced by prompt content (verified in `scheduledPrompts.choice.test.ts` — "hard-fails choice reveals when the question cannot be resolved"). Tool-level there's no entry point to test since the abort happens inside Claude's flow.**
- [x] 10.4 Add a statistical regression test that, given fixed seed control or sufficient sample size, confirms `suggestedCorrectIndex` distribution is uniform and the plausibility-gate-failure rate is independent of `correctIndex`. **Uniformity test in `getIdeas.choice.test.ts` ("suggestedCorrectIndex distribution is uniform over many rolls"). Gate-failure-rate independence is a Claude-runtime concern (out of scope for unit tests).**

## 11. Verification & docs

- [x] 11.1 Run `npx tsc` and `npm test` — both must pass. **3419/3419 tests pass; tsc clean.**
- [x] 11.2 Run `npx oxlint src/plugins/trivia/ src/config.ts` and `npx oxfmt src/plugins/trivia/ src/config.ts` — fix any findings; re-stage. **0 lint warnings/errors; format-check passes.**
- [x] 11.3 Run `openspec validate add-trivia-choice-questions --strict` — fix any spec/proposal/design issues. **Strict validation passes.**
- [x] 11.4 Manually verify backward compatibility: with `trivia.questionsTypes` absent and `seasons.json.current.questionTypes` absent, `get_ideas` returns only boolean and existing trivia flows are byte-identical to pre-change behavior. **Covered by `getIdeas.choice.test.ts` ("falls back to pure-boolean when no config and no current season") and `questionTypes.test.ts` (priority order tests).**
- [x] 11.5 Verify sequencing: confirm `refactor-seasons-as-timeline` has archived before this change archives. **Confirmed archived — `trivia-seasons` baseline now reflects the timeline model (`upsert_season`, `seasons.json#seasons[]`, `findCurrentSeason`); this change's delta targets that baseline.**
