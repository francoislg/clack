## Why

Claude can't currently ask "what was in the last batch I posted?" Today the only way to inspect a batch is to know its UUID up front (which Claude never sees) or to scroll through `find_previous_questions` results by `postedAt`, which mixes adjacent batches together. With `batchId` now stamped per `post_questions` call, we can give Claude a direct "most-recent batch" lookup keyed off the current time, which is the natural framing for the reveal flow and for cross-batch theme/repetition checks.

## What Changes

- Add a new optional argument `recentBatchFromNow: number` to `find_previous_questions`. Positive 1-indexed integer: `1` = the batch with the most recent `postedAt` as of now, `2` = the batch before that, and so on.
- When `recentBatchFromNow` is set, the tool:
  - Filters posted questions (`postedAt !== undefined`) that have a defined `batchId` (legacy rows without one are excluded from this view — they are not real batches).
  - Groups by `batchId`, sorts groups by `max(postedAt)` descending, picks the Nth group (1-indexed).
  - Returns every question in that group, sorted by `postedAt` ascending.
  - Returns an empty array if N exceeds the number of available batches.
- Other existing filters (`category`, `text`, `season`, `limit`) compose normally: they are applied to the questions within the selected batch.
- The argument name (`recentBatchFromNow`) and tool description both make the "relative to now" framing explicit, so Claude does not confuse it with an absolute index or a season-relative position.
- No changes to the response shape — the same `SearchResultQuestion[]` payload (answer keys still omitted).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `trivia-question-search`: `find_previous_questions` gains a `recentBatchFromNow` argument that selects the Nth-most-recent batch (1-indexed, anchored to current time), grouping by `batchId` and excluding undefined-batchId rows.

## Impact

- **Affected code:**
  - `src/plugins/trivia/tools/questions/findPreviousQuestions.ts` — add the arg, branch on it before the existing per-question filter loop, group-and-rank logic
  - `src/plugins/trivia/tools/questions/findPreviousQuestions.test.ts` — new tests covering the recent-batch path and its interaction with other filters
- **No schema changes.** `batchId` already exists on `TriviaQuestion` from `add-trivia-question-batch-id`.
- **No data migration.** Pre-`batchId` rows are intentionally invisible to this view.
- **No external API or schedule changes.**
