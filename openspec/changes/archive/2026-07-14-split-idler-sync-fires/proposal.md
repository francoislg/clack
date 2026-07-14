# Split idler sync into light (triage-only) and deep (full-maintenance) fires

## Why

Token measurement over the last month (Jun 15 – Jul 14) showed the idler consumed ~$490 at Sonnet pricing, with the sync task as the largest share (~$270): every fire ran the full maintenance pass — PR sweep, per-unit reference re-verification, coldest-unit rotation, memory triage, discovery — averaging ~19 API calls and ~$1.25 per fire, on a schedule of up to 12 fires/day, regardless of whether anything had changed. A quiet 3 AM fire cost the same as a busy one. The actual mid-day need is much smaller: promptly triaging newly-remembered work (memory entries) as it appears. Full maintenance only has a consumer once per day — the work window that opens right after the last complement-hour fire.

## What Changes

- **Split the single sync cron spec into two specs**, both plugin-reconciled, no SDK/core changes:
  - **Light sync** — fires every `syncEveryHours` in the sync window (complement of `workHours`, or the explicit `syncHours` window), EXCLUDING the anchor hour. Runs memory triage ONLY: one recency-ordered `recall` page, classify against the existing `ignoredAt`/slice markers, adopt/ignore new candidates; when nothing is new past the markers, end immediately via `skip_response`. The light prompt does NOT embed the admin fetch-instructions document (~6k tokens), shrinking its boot context.
  - **Deep sync** — fires ONCE per sync window, at the anchor hour (the last sync-window hour before the work window opens; for an explicit `syncHours` window, its last hour). Runs today's full pass: quick-fetch + close-resolved, coldest-unit re-verification and stale parking, memory triage, and external discovery.
- **External discovery moves to the deep fire and covers ALL enabled sources per fire**, replacing the per-fire round-robin (the deep fire is now the only fire that scans, so rotation would starve sources).
- **Quick-fetch (open Clack-PR listing + per-unit reference re-polling) becomes deep-only** instead of every-fire.
- **Coldest-unit rotation and stale parking become deep-only** instead of every-fire.
- **Memory triage remains an every-sync-fire behavior** (it runs on both light and deep fires) and gains an explicit early-exit contract for the nothing-new case.
- **Cadence knob**: `syncEveryHours` (int 1–12, default 2) governs the light cadence; the deep fire is always exactly one per window. (The knob itself shipped ahead of this change; this proposal brings the spec in line.)

Expected effect for an 18→6 work window at the default cadence: 5 light fires (~$0.25–0.35 each, mostly early-exit) + 1 deep fire (~$1.50) ≈ $2.50–3/day, versus ~$7.50/day with uniform full-pass fires at the same cadence.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `idler-plugin`: "Three cooperating scheduled tasks" becomes four cron specs (light sync, deep sync, work, summary) with the sync-task requirements split by tier; "Every-fire memory-maintenance pass" is re-scoped — close-resolved moves to the deep fire, memory triage stays every-fire with an early-exit contract; "Layered incremental sync" is replaced — quick-fetch is deep-only and external discovery covers all enabled sources on the deep fire instead of rotating; "Recently-updated memory scan during sync" gains the light-fire early-exit and the no-fetch-instructions light prompt contract.
- `idler-ideas-ledger`: "Coldest-first ordering for the concierge rotation" and "Concierge parks stale units via the existing sink" are re-scoped from "each sync fire" to the deep fire (the rotation cycles once per window-day instead of hourly).

## Impact

- `src/plugins/idler/index.ts` — reconcile two sync specs (`sync` → deep at the anchor hour, new `sync-light` for the remaining hours); light spec omits fetch-instructions from its prompt build.
- `src/plugins/idler/heuristic.ts` — anchor-hour extraction: builders for "anchor hour only" and "window minus anchor, thinned by `syncEveryHours`" crons (extends the just-added `thinHours`).
- `src/plugins/idler/prompts/sync.ts` — split into a light prompt (memory-triage-only + early exit) and a deep prompt (current full pass, discovery = all enabled sources).
- `src/plugins/idler/instructions.ts` — behavior topic wording where it assumes a single sync shape (if any).
- Tests: `heuristic.test.ts`, `plugin.test.ts` (spec reconciliation), prompt tests.
- Docs: `CLAUDE.md` idler section.
- No changes to: SDK surface, core cron machinery, the ledger slice schema, `upsert_idea`/`list_top_ideas` tools, the work or summary tasks.
