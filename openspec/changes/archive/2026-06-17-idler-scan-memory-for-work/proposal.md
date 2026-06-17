## Why

Clack's core memory accumulates work-shaped entries (e.g. `sentry:1234` saved by a scheduled message or a Q&A session via `remember`) that the idler never sees, because the idler only discovers work from the sources named in its fetch instructions. Anything remembered elsewhere stays invisible to the idler, so genuinely actionable items sit idle. The idler already keys its work units by the same stable ids `remember` uses, so adopting these entries is a natural, dedup-safe extension of discovery.

## What Changes

- Add a fifth idler discovery source: **recently-updated core memory entries**. During the sync round-robin, the idler reads a recency-ordered page of memory entries (via the existing `recall` tool, no query), classifies each from its idler slice, and for each untriaged candidate decides — adopt it as a work unit (`upsert_idea`, by its existing stable id) or mark it as not-idler-work.
- Add a triage marker `ignoredAt` to the idler work-state slice — a **snapshot of the entry's `updatedAt`** at ignore time. An ignored entry is skipped while `ignoredAt` equals `updatedAt`, and re-qualifies once a genuine content write advances `updatedAt` past the snapshot.
- Add a no-touch option to the SDK namespace merge (`merge(..., { touch: false })`) so the ignore write records idler's processing without bumping the entry's `updatedAt` — without it, the ignore write would advance `updatedAt` and re-trigger the entry every fire (infinite re-triage loop).
- Add config `sources.scanMemory: boolean` (default `true`) gating the new source. Within the already-gated idler, existing deployments begin scanning memory on upgrade.
- Reuse the existing `recall` tool unchanged. Enhance the existing `upsert_idea` tool to accept `ignore` and snapshot `ignoredAt` via the no-touch merge. **No new tool is added.**

## Capabilities

### New Capabilities
<!-- none — this extends existing idler capabilities -->

### Modified Capabilities
- `idler-plugin`: the "Four configurable work sources" requirement becomes five (adds recently-updated memory as a source); the "Layered incremental sync" round-robin gains a memory-scan rotation entry; config gains `sources.scanMemory`.
- `idler-ideas-ledger`: the work-state slice gains an `ignoredAt` triage marker with re-evaluation-on-update semantics, extending stable-source-keyed identity to memory-originated entries.

## Impact

- `src/memoryRegistry.ts` — `mergeMemoryNamespace` gains `opts?: { touch?: boolean }` (default `true`)
- `src/plugins/sdk.ts` + `src/plugins/sdkMemory.ts` — `ClackSdkMemoryData.merge` gains the optional `opts` and threads it through
- `src/plugins/idler/types.ts` — `IdlerSources.scanMemory`
- `src/plugins/idler/config.ts` — `sourcesSchema.scanMemory` with `.default(true)`, tolerant of legacy `sources` objects lacking it
- `src/plugins/idler/slice.ts` — `idlerSlotSchema.ignoredAt?` (snapshot of `updatedAt`)
- `src/plugins/idler/tools/ideas.ts` — `upsert_idea` gains `ignore?`, makes `kind` optional, snapshots `ignoredAt` via the no-touch merge, and clears `ignoredAt` on adopt
- `src/plugins/idler/prompts/sync.ts` — memory-scan rotation step, gated on `config.sources.scanMemory`
- No change to the core `recall` or `remember` tools; plugin boundary preserved (the SDK merge addition is a sanctioned SDK expansion).
