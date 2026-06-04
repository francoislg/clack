## 1. Config wiring (mirror allTimeRow)

- [x] 1.1 Add `includeRevealInQuestions?: "yes" | "no"` to `TriviaGame` and `TriviaConfig`, plus `DEFAULT_INCLUDE_REVEAL_IN_QUESTIONS = "no"` and the literal-union type in `core/configTypes.ts`.
- [x] 1.2 Add the zod schema + `validateIncludeRevealInQuestions` in `core/configParsers/axes.ts`; wire per-game parse in `core/configParsers/games.ts` and workspace parse in `core/configBridge.ts`.
- [x] 1.3 Add `domain/includeRevealInQuestions.ts` with `resolveIncludeRevealInQuestions(game, workspace)` (verbatim shape of `resolveAllTimeRow`).
- [x] 1.4 Tests: resolver cascade + default; parser valid/invalid/absent (mirror `allTimeRow` test files).

## 2. Question record + persist tool

- [x] 2.1 Add optional `revealBlocks?: KnownBlock[]` to `TriviaQuestion`.
- [x] 2.2 Build `tools/questions/updateQuestion.ts` — `update_question({ game, questionId, revealBlocks })`, admin tier, writes to `questions.json`, no Slack, idempotent overwrite.
- [x] 2.3 Guard: reject when `resolveIncludeRevealInQuestions` is `"no"`.
- [x] 2.4 Tests: persists when yes, overwrite-not-append, rejection when no.

## 3. compute_answers returns the axis

- [x] 3.1 In `computeAnswers`, resolve and add `includeRevealInQuestions` to the payload (alongside `allTimeRow`/`revealType`-style resolution).
- [x] 3.2 Tests: payload carries value; default when unset; resolved-fresh after mid-cycle change.

## 4. update_answers_block append branch

- [x] 4.1 When a question record has `revealBlocks`, render the deterministic footer then append the blocks (before the "See your answer" button); unchanged when absent.
- [x] 4.2 Keep rebuild deterministic/idempotent.
- [x] 4.3 Tests: ordering, facts-only when absent, re-projection-after-reauthoring reconciliation.

## 5. find_previous_questions opt-in exposure

- [x] 5.1 Add `includeRevealBlocks` flag / targeted-id path returning `revealBlocks` ONLY for revealed questions; never default list; never live questions.
- [x] 5.2 Tests: default omits, targeted opt-in returns for revealed, opt-in withholds for live.

## 6. Reveal prompt branch

- [x] 6.1 In `PROCESS_REVEAL_INSTRUCTIONS`, when `includeRevealInQuestions: "yes"`, author per-question narrative via `update_question` before `update_answers_block`; when `"no"`, today's flow.
- [x] 6.2 Add `"mcp__trivia__update_question"` to the reveal job's `requiredTools` in `buildGameSpecs.ts`.
- [x] 6.3 Prompt-inspection tests for both branches + requiredTools.

## 7. Management surface

- [x] 7.1 `upsert_game` and `set_workspace_config` accept `includeRevealInQuestions` (omit-to-keep / null-to-clear).
- [x] 7.2 `list_games` surfaces per-game + `workspaceDefaults.includeRevealInQuestions` when set.
- [x] 7.3 Management round-trip tests.

## 8. Specs & verification

- [x] 8.1 `/opsx:sync` deltas after `refactor-trivia-reveal-tools` has archived. (Deferred to `/opsx:archive`, which folds the deltas into the base specs.)
- [x] 8.2 `npx tsc` clean; `npx oxlint` + `npx oxfmt --check` clean on touched files.
- [x] 8.3 Full `npm test` green; confirm axis-unset behaves identically to facts-only cards.
- [x] 8.4 i18n parity for any new direct-to-Slack strings.
- [x] 8.5 `graphify update .`.
