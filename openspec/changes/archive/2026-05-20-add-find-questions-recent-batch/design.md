## Context

`add-trivia-question-batch-id` recently stamped a per-call UUID on every question written by `post_questions`. With that field in place, Claude can now look at a single batch as a unit. But `find_previous_questions` today only filters by `category`, `text`, and `season` — there is no way for Claude to ask "what did I post last?" without scrolling by `postedAt` and guessing where one batch ends and the next begins.

The natural framing for Claude is recency relative to the current moment: "the latest batch", "the batch before that". This change adds one argument expressing exactly that.

## Goals / Non-Goals

**Goals:**
- Let Claude fetch a complete batch by its recency rank as of now ("most recent", "second most recent", etc.).
- Make the "from now" framing self-evident in the tool's surface so Claude doesn't mistake it for an absolute index or a season-relative position.
- Reuse existing filter semantics — no new response shape, no new tool.

**Non-Goals:**
- Exposing `batchId` to Claude as a first-class identifier. It stays internal; Claude addresses batches by recency, not by UUID.
- Supporting "Nth oldest batch" or batch lookup by absolute time window. Out of scope until a use case appears.
- Backfilling `batchId` onto pre-deploy questions. Legacy rows remain `batchId === undefined` and are excluded from this view.

## Decisions

### Argument name: `recentBatchFromNow`

Explicit, slightly verbose, and unambiguous about the anchor. Alternatives considered:
- `recentBatch` — clear about recency but loses the "from now" anchor; Claude could plausibly read it as "the recent batch within the season I'm filtering to".
- `batchOffset: 0 | 1 | 2` — zero-indexed offsets invite off-by-one mistakes in LLM-generated args. Positive 1-indexed is harder to misread.
- `lastBatch: number` — "last" is ambiguous (final? most recent?).

The verbose name carries its own documentation; the description repeats the "as of the current moment" framing.

### Positive 1-indexed (1, 2, 3, …), not negative offsets (-1, -2, -3)

Tool descriptions in natural English read more cleanly as "the 2nd most recent batch" than "batch -2". LLMs also handle ordinal positives more reliably than negative offsets. `N <= 0` is rejected with a validation error. `N` exceeding the number of distinct batches returns an empty array (consistent with the "no matches" scenario the tool already supports).

### Filter composition: apply all filters BEFORE batch grouping

When `recentBatchFromNow` is combined with `category`, `text`, or `season`, the filters are applied to the per-question pool first; then the surviving questions are grouped by `batchId`, ranked by `max(postedAt)` descending, and the Nth group is returned.

Rationale: this gives "the Nth most recent batch CONTAINING questions that match my filters" — a single consistent rule. The alternative (rank batches first, then filter inside the selected batch) is harder to explain and creates surprising empties when Claude narrows by category.

Practical consequence: with no filters, the result is just "the Nth most recent batch in full". With a category filter, Claude might get back a 2-question subset of a 3-question batch — which is the expected behavior for a search tool.

### Legacy rows (batchId === undefined) are excluded

`find_previous_questions` without `recentBatchFromNow` is unchanged — legacy rows still surface there. Only the recent-batch view hides them, because they are not actually batches and shouldn't dilute the recency ranking.

### Interaction with the existing "at least one search parameter required" rule

`recentBatchFromNow` counts as a valid search parameter. Passing it alone (no `category`, `text`, or `season`) is valid and returns the Nth most recent batch in full.

## Risks / Trade-offs

- **[Risk]** Claude confuses "most recent" with "most recent in the current season" when `season: "current"` is also passed → **Mitigation**: the tool description explicitly states the recency ranking is computed AFTER filters, so the combination means "most recent batch within the current season".
- **[Risk]** Empty result when `recentBatchFromNow=1` but the only posted questions are legacy (no batchId) → **Mitigation**: this is the intended behavior; Claude can fall back to the unfiltered call. The empty result is not an error.
- **[Trade-off]** Choosing filter-first composition means a high `recentBatchFromNow` value combined with a narrow filter can require scanning many batches before reaching the Nth that matches. In practice the dataset is small (hundreds of questions, dozens of batches per game), so the cost is negligible.

## Migration Plan

No migration. Pure additive change to one tool argument. Deployment order doesn't matter — old clients ignore the new arg, new clients work against any data shape (including all-legacy pools, which simply return empty for this view).
