## Why

`process_reveal_answers` suppressed the per-player round scoreboard (`roundSummary` → the "This Round" leaderboard row + the multi-question "Round Summary" block) whenever any reveal entry was not `"yes"` mode. But `revealResponses` is **strictly** a per-question DISPLAY axis — it controls how much per-question attribution the reveal prose shows (name everyone / winners only / nobody). It has nothing to do with the scoreboard. The scoreboard is an AGGREGATE the game is built around; like the cumulative leaderboard (Current Season / All Time, shown in every mode), it must be available every round regardless of how individual questions were displayed. The old gate wrongly derived the scoreboard from the *redacted* `voters` payload, so restricted display modes lost the aggregate too. A live season set to `just-correctness` lost its "This Round" row for this reason.

## What Changes

- `process_reveal_answers` SHALL ALWAYS include `roundSummary`, computed from the SCORED ANSWERS (the same source of truth as `leaderboard`), independent of every entry's `revealResponses`. `perPlayer` is empty only when nobody answered this round.
- Cheaters/bot/pending rows are excluded by the standard scoring filter (`isScoredAnswer`) — identical to the leaderboard. Cheating handling is orthogonal to the reveal; cheated answers are always ignored.
- The reveal prompt renders the "This Round" row and "Round Summary" block whenever `roundSummary.perPlayer` is non-empty — never gated on `revealResponses` or `reveals.length`.
- `revealResponses` continues to govern ONLY the per-question `voters` display shape (`yes` / `just-correctness` / `just-winners` / `no`) — unchanged.
- **BREAKING (payload contract):** `roundSummary` changes from optional to **always present**. Consumers may stop guarding for its absence (but an empty `perPlayer` still means "nobody answered this round").

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `trivia-reveal-processor`: `roundSummary` is always present and derived from scored answers, independent of `revealResponses`; the `"just-winners"` variant no longer suppresses it.
- `trivia-scheduled-prompts`: the "This Round" row and "Round Summary" block are gated on `roundSummary.perPlayer` being non-empty, never on reveal mode.

## Impact

- Code: `src/plugins/trivia/tools/reveal/roundSummary.ts` (rewritten to take scored answers + a displayName resolver), `processRevealAnswers.ts` (builds the scored-answer set with `isScoredAnswer` and always emits `roundSummary`), `types.ts` (`roundSummary` now required), `scheduledPrompts.ts` (`PROCESS_REVEAL_INSTRUCTIONS` render gating).
- Tests: `roundSummary.test.ts` (new answers-based signature), `processRevealAnswers.test.ts` (always-present + mode-independent + cheater-exclusion + empty-perPlayer cases), `scheduledPrompts.test.ts` (gate-wording assertions).
- Runtime: no migration, no stored-data change. `roundSummary` is recomputed at reveal time from `answers.json`, so already-posted questions (any mode) get their scoreboard at the next reveal fire. No config change needed.
