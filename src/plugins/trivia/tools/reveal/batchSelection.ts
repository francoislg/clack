import type { TriviaQuestion } from "../../core/types.js";

/**
 * Select the questions belonging to a batch handle: rows whose `batchId` equals
 * the handle, plus (for legacy/undefined-batchId rows) the single row whose `id`
 * equals the handle. Sorted by `postedAt` ascending to mirror reveal order.
 *
 * Shared by `update_answers_block` (card re-projection) and `compute_answers`
 * (reprocess-by-batchId) so both tools resolve a batch handle identically.
 */
export function selectBatch(questions: TriviaQuestion[], handle: string): TriviaQuestion[] {
  const matches = questions.filter(
    (q) => q.batchId === handle || (q.batchId === undefined && q.id === handle),
  );
  return matches.sort((a, b) => (a.postedAt ?? 0) - (b.postedAt ?? 0));
}
