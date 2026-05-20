## Context

The trivia plugin lets a season declare a `format` with multiple `slots`, in which case one cron fire posts N questions in a single `post_questions({ items: [...] })` call. The reveal-side prompt (`PROCESS_REVEAL_INSTRUCTIONS`) already branches on `reveals.length` — both single-question and multi-question layouts are wired — and `process_reveal_answers` returns a `roundSummary` field shaped for N-question fires.

The piece that was never landed: making the tool actually return more than one reveal in default mode. `selectOldestPending` in `src/plugins/trivia/tools/reveal/processRevealAnswers.ts` returns `[pending[0]]`. Result: a 3-slot fire produces a 1-reveal payload, and slots 2 & 3 are stranded with `postedAt` set and `processedAt` unset indefinitely.

A naive "return all pending" patch would work for the happy path but breaks cleanly on failure: if yesterday's reveal failed mid-flight and left 3 questions pending, today's reveal would emit a 6-reveal payload mixing two unrelated cron fires into one Slack message and one `roundSummary`. That's worse than the current bug for any case other than the strict happy path.

The natural unit is the **batch** — every question posted in one `post_questions` call belongs together. Today there's no field to express this; `postedAt` is per-message (within seconds of siblings, but not equal) and `slot.index` is just an in-batch ordinal. This change makes the batch boundary explicit by adding a `batchId` field.

## Goals / Non-Goals

**Goals:**

- Reveal every question in a multi-slot fire in one Slack message, with a coherent `roundSummary`.
- Keep batches from different fires separate; one reveal fire processes one batch.
- Preserve chronological reveal order — if a prior batch was left pending (e.g., reveal failure), the next reveal picks IT up before any newer batch.
- Zero data migration. Legacy pending rows degrade gracefully.
- Keep the renderer prompt and `ProcessRevealResult` payload shape unchanged.

**Non-Goals:**

- Cross-batch aggregation in `roundSummary` (always per-fire, never cross-fire).
- Backfilling `batchId` on already-processed historical rows.
- A separate "batches" file or index — `batchId` lives on the question row only.
- Surfacing `batchId` to end users in Slack output. Internal coordination metadata only.

## Decisions

### Decision 1: New optional field on `TriviaQuestion` (vs. derived from `postedAt` clustering)

**Choice:** Add `batchId?: string` to `TriviaQuestion`. Stamped by `post_questions` at write time. Persisted in `games/<game>/questions.json` alongside the existing per-question fields.

**Alternatives considered:**

- **Time-window clustering at reveal time.** Group pending questions whose `postedAt` values fall within ~5 minutes of each other. No schema change.
  - Rejected: magic constant, brittle if `chat.postMessage` is slow (10+ seconds for an N=5 batch is conceivable under Slack rate limiting), and creates a non-obvious failure mode where editing the heuristic changes batch grouping for historical data.
- **Use `slot.index === 0` as the batch anchor.** Treat consecutive slots posted close together as one batch.
  - Rejected: `slot` only exists when a season has a `format`. Single-question seasons would have no batch concept, leaving the multi-question case as a special case in the consumer.
- **Side-file `games/<game>/batches.json` mapping batchId → questionId[].**
  - Rejected: second source of truth, harder to inspect, requires consistency-keeping for a tiny piece of data that lives naturally on the row.

**Rationale:** `batchId` on the row mirrors how `season`, `slot`, `postedAt`, and `processedAt` are already denormalized — read in one file load, no joins, no clustering math. Optionality preserves back-compat with legacy rows.

### Decision 2: One UUID per `post_questions` call (vs. per item)

**Choice:** `post_questions` calls `crypto.randomUUID()` ONCE at the top of the handler and reuses the same string for every fresh item it stamps in that call.

Items that hit the idempotent-skip branch (already have `postedAt`) keep whatever `batchId` they already have on disk; the call does not rewrite their row.

**Rationale:** Every item written in one call is by construction part of one logical posting event. The cron-driven flow never re-calls `post_questions` with a mix of fresh and stale items, so the idempotency branch in practice never produces a multi-batch row set from one call.

**Edge case accepted:** Manual operator calls `post_questions` twice with overlapping item lists — items posted in the second call get a NEW batchId, splitting what felt like "one logical post" into two batches. Acceptable: this isn't a path the system itself ever takes, and the reveal flow's "oldest batch first" rule still produces sane output (the first batch reveals first, the second a fire later).

### Decision 3: Pick the OLDEST pending batch, not the newest

**Choice:** `process_reveal_answers` default mode picks the batch whose `min(postedAt)` is smallest, processes every row in it, and stamps `processedAt` on each.

**Alternatives considered:**

- **Pick the newest batch.** Always reveal today's questions today; rely on admin reprocessing for stragglers.
  - Rejected: the failed-reveal scenario then permanently strands old questions in the renderer's sense — admin would have to remember to reprocess. With "oldest first", the system self-clears the backlog one fire at a time, in chronological order.
- **Process every pending batch, emitting one reveal payload but with batch boundaries somehow encoded in `roundSummary`.**
  - Rejected: the renderer prompt does not model multiple batches in one payload, and a multi-batch `roundSummary` is semantically muddled ("who got the most right *today*?" stops meaning the same thing across days).

**Rationale:** Reveals lag by one fire when a backlog exists, which is strictly better than the current "stuck forever" or the naive-fix "mix everything together". The leaderboard table is cumulative, so lag in the verdict text isn't visually disruptive — the running scoreboard stays accurate.

### Decision 4: Legacy rows (undefined `batchId`) are singleton batches

**Choice:** When grouping pending questions by `batchId`, every row with `batchId === undefined` is treated as its own group of size 1.

**Rationale:** Pre-deploy multi-slot batches that were already pending (i.e., the exact bug scenario this change fixes for go-forward writes) would reveal one-per-day until cleared. Less efficient than re-stitching them back into batches, but mathematically correct and operationally observable — admin sees the queue drain.

**Migration alternative considered:** A one-shot back-fill that groups pending rows by `postedAt` proximity and assigns synthetic batchIds.
- Rejected for now: the bug scenario in practice produces at most ~30 stranded questions across the user's known game (= one season's worth of multi-slot failures), and `reprocessQuestionIds` already exists for admin fixup. Not worth the migration scaffolding.

### Decision 5: Don't suppress season rollover when batch crosses a season boundary

**Choice:** Keep the existing rollover branch (`isLastFireOfSeason`) untouched. If a reveal fire happens to be the season's last fire AND the processed batch belongs to a prior season (because today's batch is queued behind yesterday's failed-reveal batch), the rollover fires anyway.

**Rationale:** This is a degenerate case that requires two prior failures (reveal failure AND a season-boundary fire) to occur. Detecting it would require teaching `computeSeasonStatusAndRollover` to compare the processed batch's `season` to the current-season slug, which adds branching for a scenario that won't happen on any healthy schedule. Admin can fix by calling `reprocessQuestionIds` on the deferred batch in the new season's window.

**Edge case noted, not fixed.** Re-evaluate if it actually shows up in production.

## Risks / Trade-offs

- **[Risk] Idle pending rows accumulate unnoticed.** If reveals fail silently (no log alert) for many fires, the queue grows. → Mitigation: existing log lines fire on reveal errors; this change doesn't worsen observability. Admin can `list_questions`-style inspect or just look at the questions.json file.

- **[Risk] Mixed-season batch reveals before rollover.** As discussed in Decision 5. → Mitigation: documented edge case, manual reprocess path exists.

- **[Trade-off] Reveal lag during backlog.** Yesterday's stranded batch reveals "as today's verdict" tomorrow, which could be momentarily confusing if anyone looks at the Slack timestamp. → Mitigation: the verdict text doesn't claim "today" — it references the question itself, which is permalinked. The leaderboard table is always current.

- **[Risk] Tests that seed multiple questions assuming the old "process oldest" or my interim "process all pending" behavior break.** → Mitigation: in scope of this change; updated test exists for the multi-batch and same-batch cases.
