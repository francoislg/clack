## Why

The reveal flow currently processes one pending question per fire. When a season's `format` posts N questions in a single `post_questions` call, the reveal should cover all N — but the implementation falls back to "oldest pending question only", silently stamping `processedAt` on one row and leaving the rest pending forever. A naive "process every pending row" fix would lump unrelated batches together (e.g., yesterday's failed-reveal leftovers + today's fresh batch get merged into one mixed reveal). The clean fix is to make "batch" an explicit concept: `post_questions` stamps a shared `batchId` UUID on every item it posts in one call, and `process_reveal_answers` reveals the OLDEST pending batch in full per fire.

## What Changes

- Extend `TriviaQuestion` with an optional `batchId?: string` field (UUID). Legacy rows without it remain valid and behave as singleton batches.
- `post_questions` generates ONE UUID per call and stamps it on every fresh item alongside `postedAt` and `messageLink`. Items skipped by the idempotency rule (already-posted) keep their original `batchId` untouched.
- `process_reveal_answers` default mode (when `reprocessQuestionIds` is absent or empty) now:
  - Filters pending rows (`postedAt` set, `processedAt` unset).
  - Groups them by `batchId`. Rows with `batchId === undefined` are each treated as their own singleton batch.
  - Picks the group with the oldest `min(postedAt)` and processes every row in that group (sorted oldest-first by `postedAt`).
  - Leaves other batches pending for subsequent fires.
- Tool description for `process_reveal_answers` updated from "processes the OLDEST question" to "processes the OLDEST pending batch in full".
- Existing season-rollover branch is unchanged. The known edge case where a fire processes a batch from a prior season is documented as accepted (admin can reprocess via `reprocessQuestionIds`).

## Capabilities

### New Capabilities

None — both behaviors live in existing capabilities.

### Modified Capabilities

- `trivia-question-posting`: posting a batch now stamps a shared `batchId` UUID on every item written in one `post_questions` call; idempotency-skipped items keep their original `batchId`.
- `trivia-reveal-processor`: default-mode question selection changes from "oldest pending question" to "oldest pending batch in full" (grouped by `batchId`, with `undefined` treated as a singleton). Reprocess-mode is unchanged.

## Impact

- **Affected code:**
  - `src/plugins/trivia/core/types.ts` — add `batchId?: string` to `TriviaQuestion`
  - `src/plugins/trivia/tools/questions/postQuestions.ts` — generate per-call UUID, include in the per-item `updateQuestion` payload
  - `src/plugins/trivia/tools/reveal/processRevealAnswers.ts` — replace `selectOldestPending` with batch-grouping logic; update tool description string
  - Test files in both directories
- **No data migration required.** Pending pre-deploy rows without `batchId` become singletons — at most one stale question reveals per fire until cleared, which is strictly better than today's "stuck forever" behavior.
- **No external API or schedule changes.** Cron specs, prompts, and the `ProcessRevealResult` payload shape are unchanged.
- **Dependencies:** UUID generation — Node 20+ has `crypto.randomUUID()` available globally; no new dependency.
