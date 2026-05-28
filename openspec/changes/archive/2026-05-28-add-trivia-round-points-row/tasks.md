## 1. Prompt updates

- [x] 1.1 In `src/plugins/trivia/prompts/scheduledPrompts.ts`, locate the `TABLE PARAMETER (both single-question and multi-question layouts)` section inside `PROCESS_REVEAL_INSTRUCTIONS` (~lines 696–755).
- [x] 1.2 Split the table-shape description so single-question and multi-question branches reference the table shape independently. The single-question branch keeps the existing `3-row dual-totals` / `2-row no-label` shapes verbatim. The multi-question branch references its own shapes gated on `roundSummary` presence.
- [x] 1.3 In the multi-question branch, add a `This Round` row description: position above `Current Season` / `All Time`, label cell `"This Round"`, cell content `String(correct)` looked up from `roundSummary.perPlayer` by `userId`, em-dash `"—"` for absent players, medals (`🥇 🥈 🥉 🎀`) applied ONLY to cells where `correct > 0` in `perPlayer` array order.
- [x] 1.4 Add explicit gating language stating the `This Round` row renders ONLY when `reveals.length > 1` AND `roundSummary` is present; reuse the existing wording that `roundSummary` is absent whenever any reveal entry's `revealResponses` is `"just-correctness"` or `"no"`.
- [x] 1.5 Add the 4-ROW DUAL-TOTALS TABLE shape (rows: names header, This Round, Current Season, All Time) under the gate `seasonStatus` present AND `hasPriorSeasons === true`, with one worked example matching the format of the existing 3-row example.
- [x] 1.6 Add the 3-ROW LABELED TABLE shape (rows: names header, This Round, All Time) under the gate `seasonStatus` absent OR `hasPriorSeasons === false`, with one worked example. Explicitly note this is a labeled variant of the legacy 2-row shape — the label column is new for this gate.
- [x] 1.7 Preserve the legacy 3-row dual-totals and 2-row no-label shape descriptions for the cases where the `This Round` row is NOT rendered (single-question reveal, empty-reveals acknowledgement, multi-question reveal with `roundSummary` absent). Cross-reference them from both branches so single-question keeps shipping them unchanged.
- [x] 1.8 Re-emphasize that `column_settings` SHALL still carry one `{ "align": "center" }` entry per column (label column + each player column) in both new shapes.
- [x] 1.9 Re-emphasize the existing rules that apply unchanged: Unicode emoji only in table cells (no shortcodes); table is a SIBLING of `blocks` on `submit_response`, not a member of `blocks`; if the leaderboard is empty, omit the `table` parameter entirely.

## 2. Tests

- [x] 2.1 Update `src/plugins/trivia/prompts/scheduledPrompts.test.ts` line ~397–398 — adjust the assertions that look for the literal strings `3-ROW DUAL-TOTALS TABLE` / `2-ROW TABLE` so the suite still passes after the rename to `4-ROW DUAL-TOTALS TABLE` / `3-ROW LABELED TABLE` (and the retained legacy shape labels for the single-question branch).
- [x] 2.2 Add a test asserting the prompt mentions `This Round` (label) AND `roundSummary.perPlayer` (data source) in the multi-question branch context.
- [x] 2.3 Add a test asserting the prompt explicitly gates the `This Round` row on `roundSummary` presence — e.g., scans for `"This Round"` near `roundSummary` + `"present"` (or wording confirming "omit when absent").
- [x] 2.4 Add a test asserting the prompt instructs Claude to use `"—"` (em-dash, not empty string) for absent players, and that the existing `invalid_blocks` warning still appears.
- [x] 2.5 Add a test asserting the prompt instructs Claude to apply medal prefixes only to cells where `correct > 0`, distinct from the existing rule on `Current Season` / `All Time` rows.
- [x] 2.6 Add a test asserting the single-question branch description does NOT instruct a `This Round` row — single-question keeps the existing legacy table shapes.

## 3. Verification

- [x] 3.1 Run `npx tsc` to type-check (no type changes expected, but verify the prompt file still compiles).
- [x] 3.2 Run `npm test -- src/plugins/trivia/prompts/scheduledPrompts.test.ts` to validate the prompt-test suite.
- [x] 3.3 Run `npx oxlint src/plugins/trivia/prompts/scheduledPrompts.ts src/plugins/trivia/prompts/scheduledPrompts.test.ts` to confirm no lint regressions.
- [x] 3.4 Run `npx oxfmt --check src/plugins/trivia/prompts/scheduledPrompts.ts src/plugins/trivia/prompts/scheduledPrompts.test.ts` to confirm formatting is clean.
- [x] 3.5 Run `openspec validate add-trivia-round-points-row --strict` to confirm proposal + delta still validate after any wording iteration.
- [x] 3.6 Spot-check the prompt with a real multi-question reveal payload (e.g., the existing test fixtures in `scheduledPrompts.test.ts`) by reading through the assembled prompt string to confirm the new branch reads coherently end-to-end.
