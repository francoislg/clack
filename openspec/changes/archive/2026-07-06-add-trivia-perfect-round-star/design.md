## Context

The reveal leaderboard `table` is Claude-authored per the LEADERBOARD TABLE rules in `PROCESS_REVEAL_INSTRUCTIONS` (`src/plugins/trivia/prompts/scheduledPrompts.ts`), but the *data* it renders is server-computed. `computeRoundSummary` (`src/plugins/trivia/tools/reveal/roundSummary.ts`) already stamps a `roundMvp?: true` flag on `roundSummary.perPlayer` entries, and the prompt renders from that flag rather than recomputing who won. The perfect-round star follows the exact same split: a new server flag, a new one-line render rule. No new machinery.

## Goals / Non-Goals

**Goals:**
- Add a server-computed `perfectRound?: true` flag mirroring the `roundMvp` pattern, gated on `totalQuestions >= 3 && correct === totalQuestions`.
- Render a trailing `⭐` on the `This Round` leaderboard cell for flagged players.
- Keep eligibility entirely server-side so the prompt cannot drift on the threshold.

**Non-Goals:**
- No star in the reveal narrative, the season-finale podium, or `retrieve_scores`.
- No config axis, no per-game toggle, no i18n key (the glyph is language-neutral).
- No change to scoring, sorting, or the MVP flag.

## Decisions

**Server flag, not prompt logic.** The 3-question threshold and the all-correct check live in `computeRoundSummary`, next to the `roundMvp` computation, and the prompt only reads `perfectRound`. Rationale: the prompt is a natural-language contract Claude interprets; encoding an arithmetic gate there invites drift (e.g. starring 1/1 rounds). Keeping it in code makes it unit-testable and immune to prompt edits — the same reason `roundMvp` is server-side. Alternative considered: let the prompt derive perfection from `correct === totalQuestions`. Rejected — it duplicates the threshold in prose and re-opens the "should 1/1 count?" question the flag settles once.

**`totalQuestions >= 3` as the gate.** In single- or two-question rounds a sweep is unremarkable (1/1 or 2/2), so a star there would fire almost every round and mean nothing. Three is the smallest count where sweeping the batch is a real feat. The threshold is a hard-coded constant — no config surface, matching the "one quick thing" scope.

**Star only in the `This Round` row.** The star decorates the per-fire achievement, so it belongs to the per-fire row. It is deliberately absent from `Current Season` / `All Time` (which are cumulative, not per-round) and from the season-finale layout (which replaces the table with a podium). Rationale: a "perfect round" is a property of one fire; painting it on cumulative rows would misattribute it.

**Trailing append, orthogonal to medals.** The cell becomes `"<medal> <score> ⭐"`. A perfect player necessarily holds the top `correct` value, so they always carry `🥇` — the star adds to, never replaces, the medal. The dense-rank medal rule is untouched.

## Risks / Trade-offs

- [Perfect sweep on a season finale goes unstarred, since the finale replaces the table with the podium] → Accepted per scope ("nothing more" than the scores table). The podium already celebrates standings; no star there.
- [Star could read as clutter if many players sweep a small batch] → The `>= 3` gate makes sweeps rare enough that a star stays meaningful; multi-question batches are the season-format case, not the default single-question game.
- [Prompt-contract tests assert exact wording] → Mitigated by adding the star rule + example in the same edit as the test assertions, so the contract and its test move together.

## Migration Plan

No data migration. `perfectRound` is an additive optional field on an in-memory payload; older stored `answers.json` rows are unaffected (the flag is recomputed at reveal time, never persisted). Deploy is a plain code roll-out. Rollback is reverting the code — no state to unwind.

## Open Questions

None. Scope, threshold, and placement are settled.
