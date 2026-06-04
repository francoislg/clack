## 1. Config wiring (mirror allTimeRow)

- [x] 1.1 Add `finalRevealSummary?: "yes" | "no" | "in-thread"` to `TriviaGame` and `TriviaConfig`, plus `DEFAULT_FINAL_REVEAL_SUMMARY = "yes"` and the literal-union type in `core/configTypes.ts`.
- [x] 1.2 Add the zod schema + `validateFinalRevealSummary` in `core/configParsers/axes.ts`; wire per-game parse in `core/configParsers/games.ts` and workspace parse in `core/configBridge.ts`.
- [x] 1.3 Add `domain/finalRevealSummary.ts` with `resolveFinalRevealSummary(game, workspace)` (verbatim shape of `resolveAllTimeRow`).
- [x] 1.4 Tests: resolver cascade + default; parser valid/invalid/absent.

## 2. compute_answers returns the axis

- [x] 2.1 In `computeAnswers`, resolve and add `finalRevealSummary` to the payload.
- [x] 2.2 Tests: payload carries value; default when unset; resolved-fresh after mid-cycle change.

## 3. Reveal prompt three-mode branch

- [x] 3.1 Add the localized "see the responses in thread!" pointer string to `i18n/strings/en.ts` + `fr.ts` (plugin dictionary).
- [x] 3.2 Branch `PROCESS_REVEAL_INSTRUCTIONS` on `finalRevealSummary`: `yes` = narrative + leaderboard top-level; `no` = leaderboard + closer top-level, no narrative; `in-thread` = leaderboard + pointer top-level, narrative via `thread_replies`.
- [x] 3.3 Ensure the leaderboard `table` is always on the primary (top-level) `submit_response` in every branch.
- [x] 3.4 Ensure the season finale renders top-level in every branch (in-thread: day's verdicts to thread, finale top-level).
- [x] 3.5 Prompt-inspection tests for the three branches + leaderboard-always-top + finale-top-level + in-thread-pointer+thread_replies.

## 4. Management surface

- [x] 4.1 `upsert_game` and `set_workspace_config` accept `finalRevealSummary` (omit-to-keep / null-to-clear).
- [x] 4.2 `list_games` surfaces per-game + `workspaceDefaults.finalRevealSummary` when set.
- [x] 4.3 Management round-trip tests.

## 5. Specs & verification

- [x] 5.1 `/opsx:sync` deltas after `refactor-trivia-reveal-tools` has archived.
- [x] 5.2 `npx tsc` clean; `npx oxlint` + `npx oxfmt --check` clean on touched files.
- [x] 5.3 Full `npm test` green; confirm axis-unset behaves identically to today's top-level summary.
- [x] 5.4 i18n parity for the new pointer string (FR ≠ EN).
- [x] 5.5 `graphify update .`.
