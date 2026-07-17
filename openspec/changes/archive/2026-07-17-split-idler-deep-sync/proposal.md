# Split Idler Deep Sync

## Why

A measured deep-sync fire (2026-07-16) cost 45 API calls, 256k cache-write, 4.23M cache-read — the single most expensive recurring run in the deployment. The dominant cause is structural: one fire does maintenance (quick-fetch/close-resolved + coldest re-verification + memory triage) AND full external discovery, so its context climbs past the ~166k compaction threshold, gets compacted mid-run, and then re-reads code it had already read — roughly the entire second half of the run is compaction fallout. Two secondary burns: a 6-call solo-`ToolSearch` warm-up before any real work, and unbounded fat tool results (a 45k-char channel fetch, a 30k-char whole-file Read) that ride the context for every remaining call.

## What Changes

- **Split the deep sync into two fires.** The existing deep sync (specKey `sync`, anchor hour) narrows to the **maintenance pass**: quick-fetch + close-resolved, coldest-unit re-verification/parking/priority recompute, and memory triage. A new **discovery fire** (specKey `sync-discovery`) owns external discovery across ALL enabled sources, firing once per sync-window day at an earlier sync-window hour (taking over that hour's light-sync slot). Each fire stays well under the compaction threshold, so neither compacts nor re-reads.
- **Combined-fire fallback.** When the sync window is too small to host a separate discovery hour (e.g. a single-hour window), the anchor fire runs the full combined pass exactly as today — the split is an optimization, never a coverage loss.
- **Batched ToolSearch warm-up directive.** Both sync prompts instruct Claude to load every deferred tool schema it will need in ONE batched ToolSearch message up front, instead of one schema per round trip.
- **Fat-result budget directives.** The sync prompts gain result-size rules: page channel fetches with explicit limits, `Read` with line limits, prefer targeted Grep over whole-file reads during re-verification.
- No config surface changes: the schedule derives from the existing `workHours`/`syncHours`/`syncEveryHours` knobs.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `idler-plugin`: the "Four cooperating scheduled tasks" requirement becomes up to five (adds the `sync-discovery` spec and its scheduling rule + combined-fire fallback); the "Deep sync fire runs the full maintenance pass" requirement splits into a maintenance-fire requirement and a discovery-fire requirement, plus the new prompt-budget rules (batched ToolSearch, result-size caps).

## Impact

- `src/plugins/idler/heuristic.ts` — new discovery-cron builder (picks the discovery hour from the sync schedule; returns null → combined fallback) + tests.
- `src/plugins/idler/prompts/sync.ts` — `buildSyncDeepPrompt` splits into maintenance and discovery prompt builders sharing the warm-up/budget directives; combined variant retained for the fallback + tests.
- `src/plugins/idler/index.ts` — reconcile up to three sync specs (`sync`, `sync-light`, `sync-discovery`); `plugin.test.ts` spec assertions.
- No core changes, no migration (cron reconciliation adds/removes the new spec on next reconcile), no config schema changes.
- Expected effect: ~35–45% cache-read reduction on the deep pass (no compaction, no re-read wall), ~10 fewer round trips from the warm-up batch, smaller steady-state context from result caps.
