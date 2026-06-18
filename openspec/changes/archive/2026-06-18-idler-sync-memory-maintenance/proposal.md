## Why

The idler sync is meant to be a maintenance pass over Clack's memory, but today it isn't one. Memory work is demoted to a single arm of an unenforced round-robin (one source per fire, no rotation cursor), the triage of new entries is capped at the newest-25 by recency, and closing a resolved unit is the *work* fire's job — the sync never closes anything. The result: a sync run does not reliably (1) close resolved entries, (2) triage new memory, or (3) re-rank by change. Genuinely actionable memory sits untouched, and resolved units linger open until a work fire happens to reach them.

## What Changes

- **Promote memory maintenance to an unconditional every-fire pass.** Every sync run SHALL, before any external discovery: close/refresh resolved tracked units, triage recently-changed memory, and recompute priority. This is no longer a round-robin arm.
- **Narrow the round-robin to external discovery only** — Slack channels, the external tracker, and own-PR inspection. Memory is removed from the round-robin (it is now the every-fire pass), so external sources stop competing with memory maintenance for the single per-fire slot.
- **Give the sync fire close authority.** When a tracked unit's `howToRead` shows its surface resolved/merged/closed, the sync SHALL close it (`open:false` + the existing ~2-day grace `staleAfter`), the same way the work fire does — instead of leaving it open for a later work fire.
- **Triage the newest-`updatedAt` page every fire (no round-robin gate).** The memory triage runs on every fire over a generous recency-ordered `recall` page, using the existing classify-then-take + `ignoredAt` rules. Because newly-remembered/updated entries sort to the top, running this every fire reliably catches new memory; classify-then-take drains older untriaged entries across successive fires. This is **not** a full-store sweep — it is "just enough" per-fire maintenance.
- **Keep `sources.scanMemory` gating the triage of NEW entries only.** Closing resolved tracked units and recomputing their priority are core idler duties and run regardless; disabling `scanMemory` only suppresses adoption of newly-discovered memory.

## Capabilities

### New Capabilities
<!-- none — this refines existing idler behavior -->

### Modified Capabilities
- `idler-plugin`: a new every-fire memory-maintenance pass (close-resolved + triage-newest-page) is ADDED; the "Layered incremental sync" round-robin is narrowed to external sources only (memory removed from the rotation); the "Recently-updated memory scan during sync" requirement changes from a single round-robin arm to an unconditional every-fire triage; the "Configurable work sources" memory-source scenario drops the round-robin framing.

(`idler-ideas-ledger` is unchanged: its "Sync-recomputed priority" requirement already mandates recompute-every-run, and its "Ignored triage marker" classification rules are reused as-is.)

## Impact

- `src/plugins/idler/prompts/sync.ts` — restructure into an unconditional memory-maintenance pass (close-resolved, triage-newest-page, recompute) plus an external-only round-robin
- `src/plugins/idler/types.ts` / `config.ts` — `scanMemory` semantics clarified to gate new-entry triage only (no schema change expected)
- `src/plugins/idler/prompts/sync.test.ts` — assert the every-fire pass, external-only round-robin, close-on-resolved, and the `scanMemory`-gated triage block
- No new persisted state, no new tool, and no change to the core `recall`/`remember` tools or to the work fire's own close path
