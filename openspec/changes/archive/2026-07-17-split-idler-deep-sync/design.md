# Design — Split Idler Deep Sync

## Context

The idler's deep sync (specKey `sync`) is one fire doing four jobs: quick-fetch + close-resolved, coldest-unit re-verification/parking/priority recompute, memory triage, and external discovery over all enabled sources. Measured on 2026-07-16: 45 API calls, 256k cache-write, 4.23M cache-read, 53.6k output. The run's context peaked at ~166k, triggered mid-run compaction, and the post-compaction half re-read code the pre-compaction half had already read (a wall of Read/Grep at calls 24–35). Separately, the run opened with six consecutive single-`ToolSearch` round trips loading deferred schemas one at a time, and single tool results of 45k chars (`fetch_channel_messages`) and 30k chars (`Read`) inflated every subsequent cache read.

Scheduling machinery lives in `heuristic.ts` (`syncSchedule`, `thinHours`, `buildDeepSyncCron`, `buildLightSyncCron`); prompts in `prompts/sync.ts`; spec assembly in `index.ts` (`reconcile()`).

## Goals / Non-Goals

**Goals:**

- Keep each sync fire's peak context safely below the compaction threshold (target ≤ ~100k) so no sync run compacts or re-reads.
- Preserve full coverage: every maintenance and discovery duty still runs at least once per sync-window day, before the work window opens.
- Cut the ToolSearch warm-up and fat-result overhead in all sync fires.
- Zero new config surface; derive everything from `workHours`/`syncHours`/`syncEveryHours`.

**Non-Goals:**

- No change to the work, summary, or light-sync fires' duties (light gains only the shared budget directives, which it mostly already has).
- No core/scheduler changes; no catch-up for missed sync fires (unchanged from today).
- No reduction in discovery scope — all enabled sources are still scanned daily.

## Decisions

### D1: Maintenance keeps the anchor; discovery takes the preceding light slot

The anchor-hour fire (specKey `sync`) narrows to the **maintenance pass** (quick-fetch/close-resolved, coldest rotation, memory triage). A new **discovery fire** (specKey `sync-discovery`) runs at `anchor − syncEveryHours` (mod 24) — the thinned light slot immediately before the anchor — and **replaces** the light fire at that hour.

Rationale: the maintenance pass is what primes selection (closes resolved units, recomputes priority, parks stale ones), so it must run last, immediately before the work window opens — and by then the discovery fire's newly-created units already exist and get priced into the same recompute. Running discovery second-to-last also keeps mid-day external events' latency essentially unchanged (they were only ever picked up at the anchor before).

*Alternative rejected*: discovery at the anchor, maintenance earlier — would let a unit resolved after the maintenance hour stay selectable into the work window, weakening the handoff guarantee the anchor fire exists for.

### D2: Deterministic combined-fire fallback

A new `buildDiscoverySyncCron(schedule, minuteField, stepHours)` returns the discovery cron, or `null` when the candidate hour `(anchor − stepHours) mod 24` is not among the thinned sync hours (single-hour windows, tiny windows). On `null`, `reconcile()` emits today's exact two-spec layout with the **combined** prompt (maintenance + discovery in one fire) at the anchor — behavior identical to pre-change. The split is purely an optimization; coverage never regresses.

The light-sync builder gains the discovery hour as a second exclusion (alongside the anchor), so light ∪ discovery ∪ anchor = the thinned sync schedule, each hour owned by exactly one spec.

### D3: Prompt factoring — three builders over shared blocks

`prompts/sync.ts` exports `buildSyncMaintenancePrompt(config)`, `buildSyncDiscoveryPrompt(config, fetchInstructions)`, and keeps a combined builder (current `buildSyncDeepPrompt` content) for the fallback. All three (and the light prompt where applicable) compose two new shared directive constants:

- **Batched warm-up**: "Before starting, identify every deferred tool schema this fire needs and load them ALL in a single message of batched ToolSearch calls — never one ToolSearch per turn."
- **Result budget**: page `fetch_channel_messages` with an explicit small limit; `Read` with line ranges, never whole files; prefer Grep-with-context during re-verification; if a tool result gets file-offloaded, re-call with a smaller limit instead of reading the offload file.

`fetchInstructions` (the ~6k-token admin sourcing doc) is interpolated ONLY into the discovery and combined prompts — the maintenance prompt omits it (same reasoning as the light prompt: maintenance needs the allowlist, not sourcing guidance). This alone removes ~6k tokens from the anchor fire's first turn in the split layout.

### D4: Memory triage stays in the maintenance fire

The unwindowed deep triage page (limit 50) remains part of maintenance, keeping the `MEMORY_TRIAGE_RECIPE` sharing between light and deep tiers intact. Discovery does no triage — losing the one light-triage slot it displaces is covered by the neighboring light fires (whose 24h `since_hours` window overlaps it) and the maintenance fire's unwindowed page.

## Risks / Trade-offs

- [Two fires pay two fixed first-turn costs (~35k cache-write each)] → Net strongly positive: ~35k extra write vs. the measured ~1.5–2M cache-read of compaction fallout, and the maintenance fire drops the ~6k-token fetch-instructions doc it never needed.
- [Discovery fire missed (deploy/downtime at that hour) → no discovery that day] → Same exposure as today's single deep fire (idler has no cron catch-up); unchanged risk, now split across two hours — a partial day (maintenance ran, discovery didn't) is strictly better than the current all-or-nothing.
- [Prompt directives are advisory — Claude may still solo-ToolSearch or fat-Read] → Accepted; they are cheap and the measured behavior (good MCP batching once warmed up) suggests directives steer effectively. Hard enforcement (core-side result truncation) is out of scope.
- [A unit discovered by the discovery fire but resolved within the following hour stays selectable] → The maintenance fire runs after discovery and re-verifies only the coldest 8; a just-created unit won't be in that rotation. Same exposure exists today within a single fire; unchanged in practice.

## Migration Plan

None needed. `reconcileCronJobs` is declarative — on first boot with the new code, the `sync-discovery` spec is created (or not, in fallback layouts) and the `sync` spec's prompt updates in place. Rollback = deploy previous image; reconcile removes the extra spec.
