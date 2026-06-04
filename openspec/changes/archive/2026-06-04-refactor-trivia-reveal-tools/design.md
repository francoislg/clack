## Context

Today `process_reveal_answers(game)` is a monolith: in one call it (1) selects the oldest pending batch, (2) judges freeform answers and derives the scored verdict into `answers.json`, (3) builds the reveal payload (`reveals`/`leaderboard`/`roundSummary`/`seasonStatus`), (4) edits each question's Slack card via `editRevealIntoCard`, and (5) on the season's last fire performs the irreversible rollover (stamp `endedAt`, create the continuation season). The scheduled reveal prompt then calls `submit_response` once to post the summary + leaderboard.

This coupling is what blocks replay. An admin who fixes a misjudged freeform answer, hand-edits `answers.json`, or wants to change a question's disclosure mode has no safe re-entry point: re-running the monolith re-triggers rollover and re-edits cards as a unit. The data model already separates raw inputs (button/modal rows + typed text in `answers.json`) from the derived verdict (`correct` on each row), and `start_new_season` already exists as an idempotent rollover tool — so the pieces for a clean split are present; they're just fused in one call.

This change is also a prerequisite for `add-trivia-reveal-type`, whose "edits" mode needs Claude-authored Block Kit to land in the card edit — only possible once the card edit is its own addressable, file-state-driven step.

## Goals / Non-Goals

**Goals:**
- Decompose the reveal into atomic, independently-retryable steps, each doing one thing.
- Make every reveal-tool write idempotent: re-running converges, never doubles or corrupts.
- Give admins a safe re-entry point for each failure class (bad judge, bad data, bad disclosure mode, failed card edit).
- Preserve today's Slack output exactly — no user-observable change.

**Non-Goals:**
- The `revealType` axis, `update_question`, `find_questions.revealBlocks`, and edits-mode rendering — all deferred to `add-trivia-reveal-type`.
- Moving disclosure (`revealResponses`) to projection time — explicitly rejected (see Decision 4).
- Any change to `questions.json` / `answers.json` / `seasons.json` schemas.

## Decisions

### Decision 1: Two tools, split on the Slack boundary

`compute_answers(game)` owns everything deterministic and file-local: batch selection, freeform judging of pending rows, verdict derivation, and the full payload (`reveals`, `leaderboard`, `roundSummary`, `seasonStatus`). It never calls Slack and never mutates season state. `update_answers_block(game, batchId)` owns the Slack write: it reads `questions.json` + `answers.json` and `chat.update`s each card in the batch.

**Why this cut and not another:** the Slack write is the only non-local, non-deterministic side effect in the reveal (chat.update can fail independently — rate limit, deleted message). Putting it behind its own tool means the scoring step is a pure, freely-replayable function of files, and the fragile network step is retryable in isolation without re-scoring. *Alternative considered:* a single tool with a `dryRun`/`applyEdits` flag — rejected because one tool with mode flags is exactly the coupling we're removing; the flag would still gate two responsibilities behind one call.

`update_answers_block` is the **sole editor of already-posted question cards**. New messages (the summary, the leaderboard) still go through the core `submit_response`/`post_to`; "sole editor" scopes to `chat.update` of existing cards, not all Slack output.

### Decision 2: Rollover leaves the compute step entirely

`compute_answers` reports `seasonStatus.isLastFireOfSeason` but performs no mutation. The transition moves to `start_new_season`, which is **created by this change** (it does not exist yet — CLAUDE.md documents it but it was never built; today's rollover runs inline via `applySeasonRollover` in `rollover.ts`). The new `start_new_season` tool is a thin admin-tier wrapper over the existing `applySeasonRollover` (which is a no-op for a slug already carrying `endedAt` and never duplicates an already-queued continuation). It closes whatever season is currently active, so it is **gated to the last fire by the reveal prompt** (which only calls it when `compute_answers` reports `isLastFireOfSeason`). Whole-reveal replay is safe because re-running the reveal re-resolves the season via `compute_answers`, which won't re-flag an already-closed season as the last fire — so the gate, not blind tool-level idempotency, is what prevents a double rollover.

**Why:** rollover is the single irreversible state-machine move in the reveal. If it stayed in `compute_answers`, re-running compute to fix a judge on the season's last day would roll the season over twice. Isolating it on a guarded step is the only way the "re-run any step safely" guarantee holds. *Alternative:* keep rollover in compute behind an idempotency guard — workable but it leaves an irreversible mutation on the freely-replayable path, an accident waiting to happen; cleaner to physically separate it.

### Decision 3: Replay rests on raw ≠ derived, already true in the data model

`answers.json` rows hold the raw submission (button choice / modal text) AND the derived `correct` verdict. Re-judging is only possible because the raw text is retained — `compute_answers` re-derives `correct` from the raw text + current judge, never the reverse. This change does not alter the schema; it elevates "reveal tools never overwrite raw inputs except by re-derivation" to a stated, tested invariant. Freeform judging continues to touch only *pending* rows (`correct === undefined`), so re-running `compute_answers` after a disclosure change reuses existing verdicts and makes no new judge call.

### Decision 4: Disclosure stays in the compute payload, NOT at projection time

`revealResponses` continues to shape the `voters` discriminated union inside `compute_answers` (as today), and `update_answers_block` renders the footer from those buckets. We considered moving disclosure to projection time so a mode change needs only a re-project — but re-running `compute_answers` after re-stamping the mode is already cheap (boolean/choice re-read rows; freeform reuses existing verdicts, no re-judge) and idempotent. Moving disclosure would reshape the established payload contract and the renderer for marginal benefit. Re-disclosure path: admin re-stamps `revealResponses` on the record → re-run `compute_answers` → re-run `update_answers_block`.

### Decision 6: `isLastFireOfSeason` derives from `game.revealCron`, NOT the bot-core cron registry

The only consumer of the reveal schedule is the seasons finale / rollover: "is today the last reveal before the season's `expectedEndAt`?" is answered by comparing the **next reveal fire** to `expectedEndAt`. The pre-refactor code (and the old `check_season_status`) loaded the bot-core cron-job registry (`loadJobs` → `findTriviaRevealJob`) to recover that cron expression — a plugin-isolation violation (it even carried a `TODO(plugin-isolation)`). But the cron it loaded is **identical to `game.revealCron`**, which the plugin owns in its own config (`buildGameSpecs` builds the job *from* it). So both `compute_answers` and `check_season_status` now compute next-fire via `nextCronFireAfter(game.revealCron, game.timezone, now)` and read NO bot-core state. `seasonStatus.ts` is reduced to that one pure helper; `findTriviaRevealJob` / `nextFireAfter` / `TriviaCronJobView` are deleted. The core reveal path (process the oldest pending batch → score → `batchId`) needs no schedule at all — only the optional seasons finale does.

### Decision 5: Scheduled happy path sequences the steps in the prompt

The reveal cron prompt orchestrates: `compute_answers` → `update_answers_block(batchId)` → (`start_new_season` when `isLastFireOfSeason`) → `submit_response(summary + leaderboard)`. No façade tool re-fuses the steps. *Trade-off:* the prompt does one more tool call than today; accepted because uniform, addressable steps are the whole point, and the instructions are gated per branch so each path stays linear.

## Risks / Trade-offs

- **Reshaping a large, working, heavily-specced subsystem** → Land behind a behavior-preserving guarantee: a parity test asserts the new sequence produces byte-identical cards + summary + leaderboard against fixtures captured from today's `process_reveal_answers`. Migrate scenarios 1:1 into the new capabilities before deleting the old.
- **Prompt regression — Claude skips `update_answers_block` or mis-sequences** → `update_answers_block` is in `REVEAL_REQUIRED_TOOLS`; the prompt states the strict order; tests cover the cron prompt referencing both tools.
- **Rollover double-fire during the transition window** → `start_new_season` guarded on `endedAt`/existing-continuation; idempotency test for two consecutive last-fire calls.
- **Admin partial replay leaves cards stale relative to data** → by construction `update_answers_block` is a pure projection of current file state, so running it last always reconciles; documented as the repair primitive.
- **`batchId` required by `update_answers_block`** → for legacy/undefined-batchId rows the singleton-group key (question id) is the batch handle, mirroring `compute_answers` selection; the projector accepts either.

## Migration Plan

1. Extract the scoring/payload core of `processRevealAnswers.ts` into `compute_answers`; drop its `editRevealIntoCard` call and its rollover block.
2. Wrap `editCard.ts`/`footer.ts` behind `update_answers_block`, adding batch iteration over a `batchId` and admin-tier registration.
3. Confirm/guard `start_new_season` idempotency; move the rollover trigger into the reveal prompt's last-fire branch.
4. Update `scheduledPrompts.ts` reveal instructions to the new sequence; add `update_answers_block` to `REVEAL_REQUIRED_TOOLS`.
5. Migrate spec scenarios into `trivia-answer-compute` / `trivia-card-projection`; mark `process_reveal_answers` removed in `trivia-reveal-processor`.
6. Parity test against captured fixtures; split existing tests; add replay tests.
7. **Rollback:** the change is internal to the reveal flow with no data-schema change, so reverting the commit restores the monolith with no data migration.

## Open Questions

- Should `compute_answers` and `update_answers_block` share a `batchId` return so the prompt threads it explicitly, or should `update_answers_block` default to the most-recently-processed batch when `batchId` is omitted? (Leaning: `compute_answers` returns the `batchId` it processed; prompt passes it through — explicit over implicit.)
- Does any current admin/management flow call `process_reveal_answers` directly (outside the cron)? If so, those call sites migrate to the two-step sequence and must be enumerated in tasks.
