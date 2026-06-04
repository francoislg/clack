## Why

`process_reveal_answers` does three unrelated jobs in one call — it scores answers, edits every question's Slack card, and (when seasons are on) performs the irreversible season rollover. That coupling makes the reveal **unreplayable**: an admin who fixes a misjudged freeform answer, corrects a manually-edited `answers.json`, or flips a question's disclosure mode cannot safely re-run any single step, because re-running the monolith risks re-rolling the season and re-editing cards in lockstep. We want each reveal step to be **atomic and independently retryable** — re-running any one step converges instead of corrupting state. This split is also the foundation for the upcoming `revealType` feature (`add-trivia-reveal-type`), which needs Claude-authored content to land in the card edit.

## What Changes

- **Split `process_reveal_answers` into two tools, each doing one thing:**
  - `compute_answers(game)` — the scoring authority. Reads the raw interaction log (`answers.json` button/modal rows) + the freeform judge, (re-)derives the scored verdict, computes `leaderboard` / `roundSummary` / `seasonStatus`, and returns the reveal payload. **Touches no Slack and performs no season rollover.** Idempotent: re-running re-derives from raw inputs and overwrites the derived verdict in place.
  - `update_answers_block(game, batchId)` — the deterministic projector. Reads `questions.json` + `answers.json` and edits the already-posted question card(s) via `chat.update`. Batch (one call covers a whole reveal batch), admin-callable for repair, idempotent. This is the **sole editor of already-posted question cards**; it absorbs today's internal `editRevealIntoCard` call.
- **Extract season rollover out of the compute step.** `compute_answers` only *reports* `seasonStatus.isLastFireOfSeason`; the irreversible transition (stamp `endedAt`, create continuation) moves entirely to the existing `start_new_season` path, which is already idempotent (no-op if `endedAt` is set / continuation exists). This is the one place re-running must never double-apply, so it lives on its own guarded step. **BREAKING** to the internal reveal flow (not to config or stored data): the scheduled reveal prompt now sequences `compute_answers` → `update_answers_block` → (`start_new_season` on the last fire) → `submit_response`, producing the same Slack output as today.
- **Lock in the replay invariants as testable requirements:** (1) the raw interaction log (submissions + typed freeform text) is never overwritten by a reveal tool except by re-derivation — re-judging depends on retained raw text; (2) every reveal-tool write overwrites/re-derives, never appends, so repeats converge; (3) `processedAt` is informational and never gates a reprocess; (4) `chat.update` projection is a pure function of file state.
- `process_reveal_answers` is removed as a single tool; its scenarios are redistributed across `compute_answers` (scoring/selection/payload/round-summary) and `update_answers_block` (card edit). No behavior observable to a Slack user changes in this proposal.

## Capabilities

### New Capabilities
- `trivia-card-projection`: the `update_answers_block` tool — the deterministic, admin-callable, batch projector that edits already-posted question cards from file state (`questions.json` + `answers.json`). Hosts the new admin-callable + batch + idempotency requirements; the actual card-rendering rules continue to live in `trivia-reveal-cards`.

### Modified Capabilities
- `trivia-reveal-processor`: the single tool is **renamed** `process_reveal_answers` → `compute_answers`; it no longer edits Slack cards (moved to `update_answers_block`) and no longer performs season rollover (moved to `start_new_season`). A replay/idempotency invariant and a "performs no Slack write" requirement are added. The scoring, batch-selection, payload-shape, freeform-judge, and round-summary requirements are retained (re-pointed to the new tool name).
- `trivia-reveal-cards`: the static card edit is now driven by the admin-callable `update_answers_block` tool rather than invoked internally; the see-your-answer modal and localization requirements are unchanged.
- `trivia-scheduled-prompts`: the reveal cron prompt now sequences `compute_answers` → `update_answers_block` → (`start_new_season` on the last fire) → `submit_response`; `requiredTools` for the reveal job gains `update_answers_block`.

## Impact

- **Code:** `src/plugins/trivia/tools/reveal/` (split `processRevealAnswers.ts`), `src/plugins/trivia/revealCards/editCard.ts` + `footer.ts` (now invoked by `update_answers_block`), `src/plugins/trivia/prompts/scheduledPrompts.ts` (reveal orchestration), `src/plugins/trivia/domain/buildGameSpecs.ts` (`REVEAL_REQUIRED_TOOLS`), `start_new_season` tool (idempotent rollover), the reveal management/admin tool registration.
- **Data:** no schema change to `questions.json` / `answers.json` / `seasons.json`. `processedAt` semantics unchanged.
- **Tests:** `processRevealAnswers.test.ts` and reveal-card tests split to match the new tools; new tests for step-wise replay (re-run compute after a judge fix; re-run projection after a disclosure re-stamp; rollover idempotency).
- **No user-facing behavior change.** The scheduled reveal emits the same cards + summary + leaderboard as today.
