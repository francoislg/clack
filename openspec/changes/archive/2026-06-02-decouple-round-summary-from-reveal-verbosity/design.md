## Context

`process_reveal_answers` builds a `roundSummary` (per-player correct/answered counts + MVP) that drives the reveal's "This Round" leaderboard row and multi-question "Round Summary" block. The original implementation derived it from `computeRoundSummary(reveals)` — i.e. from the payload's `voters` field — and gated its presence on `reveals.every(r => r.voters.revealResponses === "yes")`.

That coupled two unrelated concerns. `revealResponses` is purely a per-question DISPLAY axis (`VoterBuckets` in `types.ts`): `yes` names everyone, `just-correctness` names everyone but hides freeform text, `just-winners` names winners and anonymizes missers, `no` names no one. Deriving the aggregate from that redacted payload meant restricted display modes also lost the scoreboard — even though the underlying scored answers are identical across modes and the cumulative leaderboard (built from those same answers) is shown in every mode.

## Goals / Non-Goals

**Goals:**
- `roundSummary` available every round in every mode — it is an aggregate, like the leaderboard.
- Compute it from the scored answers (the source of truth), not the redacted `voters`.
- Keep `revealResponses` governing ONLY per-question display.

**Non-Goals:**
- Changing per-question display (`voters`) for any mode.
- Any new config axis, migration, or stored-data change.
- Surfacing individual per-question responses in `roundSummary` — it stays a per-player AGGREGATE.

## Decisions

**Decision: derive `roundSummary` from scored answers, not from `voters`.**
`computeRoundSummary` is rewritten to take `(revealedQuestionIds, scoredAnswers, displayNameFor)` where `scoredAnswers` is `{ questionId, userId, correct }[]`. The caller builds `scoredAnswers` by filtering `refreshedAnswers` (the same `answers.json` load the leaderboard uses) to the revealed question IDs, applying `isScoredAnswer(answer, cheaterIds, botUserId)` per question. This is mode-agnostic by construction — there is no `revealResponses` input. `correct` = revealed questions answered correctly; `answered` = revealed questions with a scored submission (correct or incorrect); reactors-who-didn't-answer don't count (they have no answer row).

*Alternative considered — keep deriving from `voters` but widen the gate to `yes` + `just-correctness`:* this was the first (insufficient) cut. It still failed `just-winners`/`no` because their `voters` payloads are redacted. Rejected — the scoreboard must be mode-independent, which only the scored-answer source provides.

**Decision: `roundSummary` is ALWAYS present (required field).**
No presence gate at the tool layer. When `reveals` is empty or nobody answered, `perPlayer` is `[]` (and `totalQuestions` reflects the revealed count). The renderer decides whether to show the row/block based on `perPlayer` being non-empty. This matches "the aggregate is always available"; presentation is a separate concern.

**Decision: cheater exclusion reuses `isScoredAnswer`.**
Cheating is orthogonal to the reveal — cheated rows are always ignored in scoring, exactly as the leaderboard does (`isScoredAnswer` already excludes cheaters, bot, and pending freeform rows). The round summary inherits the same filter, so it stays consistent with the leaderboard with no bespoke logic.

**Decision: render gate is `roundSummary.perPlayer.length > 0`, never the mode.**
`PROCESS_REVEAL_INSTRUCTIONS` renders the "This Round" row and "Round Summary" block whenever `perPlayer` is non-empty, and orders columns by `perPlayer` when present else by `currentSeasonCorrect`. All `revealResponses`-based gating language is removed.

## Risks / Trade-offs

- [Showing each player's per-round correct count in `just-winners`/`no` modes could be read as re-exposing missers] → No new disclosure: the cumulative Current Season / All Time rows (always shown, every mode) already reveal each player's aggregate correctness; "This Round" is just today's slice of the same already-public aggregate. The per-question attribution that `revealResponses` hides is unaffected.
- [`roundSummary` becoming a required field is a payload-contract change] → Internal consumer is the reveal prompt, which now treats it as always-present; the type change (`roundSummary?` → `roundSummary`) makes any missed consumer a compile error. No external consumers.
- [Round summary and leaderboard could drift if computed differently] → Both derive from the same `answers.json` load with the same `isScoredAnswer` filter, so they stay consistent by construction.

## Migration Plan

None. No stored-data or config change. `roundSummary` is recomputed at reveal time from `answers.json`, so already-posted questions (any mode) gain the scoreboard at their next reveal fire. Deploy is a code+prompt update; rollback reverts the code.
