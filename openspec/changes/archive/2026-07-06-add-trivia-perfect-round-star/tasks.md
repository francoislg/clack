## 1. Server-computed flag

- [x] 1.1 Add `perfectRound?: true` to `RoundSummaryEntry` in `src/plugins/trivia/tools/reveal/types.ts`, documented next to `roundMvp`.
- [x] 1.2 In `computeRoundSummary` (`src/plugins/trivia/tools/reveal/roundSummary.ts`), stamp `perfectRound: true` on each entry where `totalQuestions >= 3 && entry.correct === totalQuestions`; update the function doc comment to describe the flag and threshold.
- [x] 1.3 Update the `roundSummary` payload-shape doc string in `src/plugins/trivia/tools/reveal/computeAnswers.ts` to include `perfectRound?`.

## 2. Prompt rendering

- [x] 2.1 In the LEADERBOARD TABLE section of `PROCESS_REVEAL_INSTRUCTIONS` (`src/plugins/trivia/prompts/scheduledPrompts.ts`), add the `This Round` cell rule: append `" ⭐"` after the medal-and-score content for `perfectRound` entries; only this row, only flagged entries, never on em-dash cells; read the flag, do not re-derive.
- [x] 2.2 Update the `roundSummary` payload description near `scheduledPrompts.ts:836` to list the `perfectRound?` field.
- [x] 2.3 Update one worked leaderboard-table example to show a `"🥇 3 ⭐"` cell for a perfect-round player.

## 3. Tests

- [x] 3.1 Add `roundSummary.test.ts` cases: 3-question sweep flagged; 2/3 not flagged; all-attempted-but-not-all-answered not flagged; 2-question sweep NOT flagged (threshold); multiple perfect players both flagged.
- [x] 3.2 Add `scheduledPrompts.test.ts` assertions: the prompt describes the trailing-star rule for `perfectRound` and includes the worked `"🥇 3 ⭐"` example.

## 4. Verify

- [x] 4.1 Run `npx tsc`, `npx oxlint` on touched files, and `npm test` for the trivia suite; fix any failures.
