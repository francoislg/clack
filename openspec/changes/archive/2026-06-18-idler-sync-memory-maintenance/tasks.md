## 1. Restructure the sync prompt

- [x] 1.1 In `prompts/sync.ts`, restructure `buildSyncPrompt` to emit four explicit ordered blocks: (1) quick-fetch + close-resolved, (2) triage recently-changed memory (newest-`updatedAt` page, every fire), (3) recompute-priority, (4) external-only round-robin. Remove memory from the round-robin source list (`memorySource`)
- [x] 1.2 Add the close-resolved step inside block (1): after re-running each tracked unit's `howToRead`, when a surface reads resolved/merged/closed instruct `upsert_idea open:false` + grace `staleAfter` (~2 days), the same close move `prompts/work.ts` uses; keep the "do not touch the unit the work fire is advancing" rule
- [x] 1.3 Turn the existing MEMORY SCAN block into block (2): unconditional every-fire (not "one of the rotated discovery sources"), generous recall page, classify-then-take, existing `ignoredAt` classification + allowlist adoption + `getArchived` enrichment. Keep it gated on `sources.scanMemory`
- [x] 1.4 Ensure the recompute-priority block (3) renders on every fire and is NOT gated by `sources.scanMemory` — the restructure must not fold it under the triage gate

## 2. Tests

- [x] 2.1 In `prompts/sync.test.ts`: assert `buildSyncPrompt` renders all four blocks, the round-robin source list excludes memory, the memory triage is framed as every-fire (not a rotated/round-robin arm), and close-resolved (`upsert_idea open:false`) is present
- [x] 2.2 Assert `sources.scanMemory: false`: the prompt still renders close-resolved + recompute-priority, but omits the memory-triage block
- [x] 2.3 Keep/adjust the existing `scanMemory` true/false assertions so they reflect the new block structure

## 3. Verify

- [x] 3.1 `npx tsc` type-check; `npx oxlint` + `npx oxfmt` on touched files; run the idler test suite
- [x] 3.2 `openspec validate idler-sync-memory-maintenance --strict`
