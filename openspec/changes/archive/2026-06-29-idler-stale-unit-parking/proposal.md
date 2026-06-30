## Why

The idler's work fire selects from the top of `list_top_ideas` (sorted by priority, capped at a top-N window). A high-priority unit that has gone stale — a perma-failing `implement`, a `review` with no new commits, a unit whose `staleAfter` horizon has passed — keeps sorting to the top but is never workable, shadowing genuinely workable units below the window. The idler gets "stuck": it does nothing while real work sits at rank 6+. Today the sync ("concierge") fire is told to recompute priority for stale units, but it has **no tool that surfaces which units are stale** (`updatedAt`, `staleAfter`, and overdue-ness are absent from every ledger read tool), so the instruction is a vague whole-ledger sweep an LLM performs unreliably.

## What Changes

- Extend the `list_top_ideas` read surface so the concierge can see staleness: each returned unit gains `updatedAt`, `staleAfter`, and a computed `overdue` boolean (so the LLM never has to do date math).
- Add a `sort_by` argument to `list_top_ideas`: `"priority"` (default — unchanged, what the work fire uses to pick) and `"coldest"` (`updatedAt` ascending — a least-recently-attended rotation the concierge walks through what-needs-a-look). The bump that every `upsert_idea` already applies to `updatedAt` is the rotation engine: a re-verified unit drops to the back of the coldest queue, giving fair round-robin coverage.
- Tighten the sync prompt: each fire, pull the N coldest open units and re-verify each — `overdue` / no fresh activity → park via the existing `blocked` sink (stays open, drops out of the work window, auto-resurfaces when `freshInput` is next detected); fresh activity → raise via `freshInput`; otherwise refresh `whereWeAre`.

Non-goals (explicitly out of scope, no change here): the `kind` weight ordering (`review` vs `implement`), the `freshInput` boost magnitude, any new config fields, any new `manualPriority` / reprioritize behavior, and any migration. The fix reuses the existing `blocked` (sink) and `freshInput` (resurface) mechanics — `priority.ts`, `slice.ts`, and `config.ts` are untouched.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `idler-ideas-ledger`: the *Sync-recomputed priority* requirement's read surface now exposes `updatedAt`/`staleAfter`/`overdue` and a `coldest` ordering, and the sync task SHALL rotate coldest-first to re-verify open units and park overdue/stale ones via the existing priority sink while keeping them open for resurfacing.

## Impact

- `src/plugins/idler/tools/ideas.ts` — `list_top_ideas`: new `sort_by` arg, three new output fields, `overdue` computation against `now`.
- `src/plugins/idler/prompts/sync.ts` — concierge instruction gains the coldest-rotation park/refresh step.
- `src/plugins/idler/tools/tools.test.ts` — coverage for `sort_by: "coldest"` ordering and the new output fields.
- No changes to `priority.ts`, `slice.ts`, `config.ts`, the management tools, or persisted state shape; no migration.
