## Context

The idler sync fire (`prompts/sync.ts`) is structured as: a cheap quick-fetch every run, then a single round-robin discovery slot ("do ONE source per fire"), then a priority recompute. Memory triage was bolted on as a fourth/fifth arm of that round-robin (the `2026-06-17-idler-scan-memory-for-work` change), gated by `sources.scanMemory`. Three consequences make the sync fail as a memory-maintenance task:

1. The round-robin has **no rotation cursor** — "rotate" is a prompt instruction with no state backing it, so Claude can favor one source for an entire window and never reach the memory scan.
2. The memory scan reads the **newest-25 by `updatedAt`** and adopts ≤5; entries outside that window are invisible, and the cadence is at most once per however-many-sources fires.
3. **Closing a resolved unit lives only in the work fire** (`prompts/work.ts` — `upsert_idea open:false`). The sync detects activity and re-ranks but never closes, so resolved units linger open until a work fire reaches them.

Idler work-state is a `plugins.idler` slice on a core memory entry (there is no `ideas.json`); sync runs hourly during the off-hours complement window.

## Goals / Non-Goals

**Goals:**
- Each sync run, unconditionally: close resolved tracked units, triage recently-changed memory, and recompute priority.
- Make memory triage cadence deterministic (every fire) and complete-enough for realistic off-hours volume, without a full-store sweep and without new persisted state.
- Keep external discovery (channels/tracker/own-PRs) on its incremental round-robin — those are genuinely expensive and fine to spread.

**Non-Goals:**
- A full memory-store iteration / exhaustive sweep (explicitly rejected by the requester — "just enough").
- Changing the work fire's own close path, the core `recall`/`remember` tools, or the `ignoredAt` classification semantics.
- Pruning — expiry stays owned by the core daily review via the idler pre-expire hook.

## Decisions

### 1. Split the sync into a memory-maintenance pass + an external-only round-robin

Restructure `buildSyncPrompt` so every fire runs, in order:
1. **Quick-fetch + close-resolved** — list open Clack PRs, re-run each tracked unit's `howToRead`; when a unit's surface reads resolved/merged/closed, close it (`open:false` + ~2-day grace `staleAfter`), mirroring the work fire's close path.
2. **Triage the newest-`updatedAt` page** — adopt or ignore recently-changed memory entries (Decision 2), gated by `scanMemory`.
3. **Recompute priority** — unchanged (already mandated by `idler-ideas-ledger` "Sync-recomputed priority").

Then the **external** round-robin (channels / tracker / own-PRs only) runs as one-source-per-fire. Memory is removed from that rotation.

*Alternative considered:* add a rotation cursor so memory gets a fair round-robin turn. Rejected — memory triage is read-only/cheap and is the sync's primary purpose; it should not be rate-limited against external polls at all.

### 2. Triage a generous newest-`updatedAt` page every fire — no persisted cursor

Each fire, when `scanMemory` is enabled, the triage step reads a generous recency-ordered `recall` page (no query, newest `updatedAt` first), classifies the whole page by the existing `ignoredAt` rules (untriaged, or `ignoredAt != updatedAt` ⇒ candidate), and adopts/ignores up to a handful of candidates (classify-then-take, so it slides past already-triaged newest entries to reach older untriaged ones).

This works because `remember` stamps the current time on every content write, so **newly-remembered or re-remembered entries always sort to the top of the page** — running the scan *every* fire (instead of one round-robin arm in N) is what makes new memory reliably caught. Older untriaged entries drain across successive fires via classify-then-take, and the `ignoredAt` marker keeps unchanged not-work entries from being re-triaged.

*Why no cursor.* An earlier design persisted a last-sync `updatedAt` cursor to bound triage to "changed since last sync." Rejected for two reasons: (1) **architecture** — the cron `prompt` is a static string built once at `reconcile()` time, not per-fire; there is no per-fire hook to read/advance a cursor without new cron infrastructure. (2) **scope** — the requester asked for "just enough," not a complete sweep; for realistic off-hours volume a generous newest-page every fire already catches new memory and drains the backlog, so the persisted cursor (and its cold-start/restart edge cases) is unjustified complexity. The page size is a generous constant in the prompt; if backlog ever outpaces it, the fix is a larger constant, not new state.

### 3. Sync gains close authority, reusing the work-fire contract

Closing in sync uses the identical `upsert_idea open:false` + grace-`staleAfter` move the work fire already uses, so there is one close contract. Sync still must not touch the unit the work fire is actively advancing (existing "Work-task authority" requirement in `idler-ideas-ledger` is unchanged and continues to protect the in-flight unit).

### 4. `scanMemory` gates new-entry triage only

Closing resolved tracked units and recomputing their priority are core idler duties and run regardless of `scanMemory`. The flag continues to gate **adoption of newly-discovered memory** only. This preserves the existing "Memory source is gated by config" behavior (disabling it stops new adoptions) while ensuring maintenance of already-adopted units never silently stops.

## Risks / Trade-offs

- **Backlog burst outpaces one page** → if more new entries appear in one hour than the page/take size, the tail is triaged on later fires (classify-then-take favors untriaged). Self-heals; off-hours volume makes this rare. Mitigation if it ever bites: raise the page-size constant in the prompt — no new state.
- **Re-triage of unchanged entries** → prevented by the existing `ignoredAt` snapshot (the no-touch ignore write does not bump `updatedAt`, so an ignored entry is not re-classified as a candidate until real content advances it).
- **Two close paths (sync + work)** → both share the same `upsert_idea open:false` contract, so divergence risk is low; the work-task authority rule keeps them from racing the same unit.
