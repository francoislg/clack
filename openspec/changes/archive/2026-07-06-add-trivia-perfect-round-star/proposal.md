## Why

A trivia round with 3+ questions where a player answers every one correctly is a genuine achievement, but the leaderboard table renders it as an ordinary `This Round` score with no distinction. A small "perfect round" star gives that sweep a visible reward at the moment it happens.

## What Changes

- `computeRoundSummary` stamps a new server-computed `perfectRound?: true` flag on each `roundSummary.perPlayer` entry when the player answered **every** revealed question correctly AND the round had **at least 3** questions (`totalQuestions >= 3 && correct === totalQuestions`). Below 3 questions the flag is never set, so trivial 1/1 or 2/2 rounds are not starred.
- The `compute_answers` payload documentation gains the `perfectRound?` field alongside the existing `roundMvp?`.
- The reveal prompt's LEADERBOARD TABLE rules append a trailing `" ⭐"` to a player's `This Round` cell when their `perfectRound` flag is set (e.g. `"🥇 3 ⭐"`). The star is orthogonal to the dense-rank medal.
- Eligibility is decided entirely server-side; the prompt never re-derives the 3-question threshold — it only reads the flag.

Not in scope: the star lives only in the `This Round` leaderboard row. It does not appear in the reveal narrative, the season-finale podium (which replaces the table entirely on the last fire), or the `retrieve_scores` output.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `trivia-reveal-processor`: `roundSummary.perPlayer` entries gain an optional `perfectRound` flag computed from `totalQuestions >= 3 && correct === totalQuestions`.
- `trivia-scheduled-prompts`: the `This Round` leaderboard-table cell renders a trailing `⭐` for players whose `perfectRound` flag is set.

## Impact

- `src/plugins/trivia/tools/reveal/roundSummary.ts` — flag computation + doc comment.
- `src/plugins/trivia/tools/reveal/types.ts` — `RoundSummaryEntry.perfectRound?: true`.
- `src/plugins/trivia/tools/reveal/computeAnswers.ts` — payload-shape doc string.
- `src/plugins/trivia/prompts/scheduledPrompts.ts` — LEADERBOARD TABLE `This Round` cell rule + one worked example, plus the `roundSummary` payload-shape description (listing the new `perfectRound?` field).
- Tests: `roundSummary.test.ts`, `scheduledPrompts.test.ts`.
- No config, no migration, no new i18n keys (the ⭐ glyph is language-neutral).
