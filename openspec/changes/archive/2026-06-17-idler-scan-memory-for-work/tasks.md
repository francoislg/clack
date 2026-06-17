## 1. SDK — no-touch namespace merge

- [x] 1.1 Add `opts?: { touch?: boolean }` to `mergeMemoryNamespace` in `src/memoryRegistry.ts`; when `touch === false`, preserve `base.updatedAt` instead of `nowIso()` (default keeps today's bump). Update the doc comment.
- [x] 1.2 Thread the option through `ClackSdkMemoryData.merge(id, partial, opts?)` in `src/plugins/sdk.ts` and `createMemorySurface` `data().merge` in `src/plugins/sdkMemory.ts`
- [x] 1.3 Add a test (extend `src/plugins/sdkMemory.test.ts` or `memoryRegistry` tests): `touch: false` merge leaves `updatedAt` unchanged; default merge still bumps it; existing callers unaffected

## 2. Config — memory as a discovery source

- [x] 2.1 Add `scanMemory: boolean` to `IdlerSources` in `src/plugins/idler/types.ts` with a doc comment
- [x] 2.2 Add `scanMemory: z.boolean().default(true)` to `sourcesSchema` in `src/plugins/idler/config.ts`; confirm a persisted `sources` object lacking the field parses to `true` (graceful reader)
- [x] 2.3 Add/extend a config parse test asserting default `true` and that a legacy `sources` object without `scanMemory` reads as `true`

## 3. Slice — ignored triage marker

- [x] 3.1 Add `ignoredAt: z.string().optional()` to `idlerSlotSchema` in `src/plugins/idler/slice.ts` with a doc comment (snapshot of `entry.updatedAt`; candidate when it differs from current `updatedAt`)
- [x] 3.2 Add a round-trip + legacy-parse test: a slice with `ignoredAt` round-trips; a legacy slice lacking it still parses (no `ignoredAt` set)

## 4. upsert_idea — ignore path (snapshot + no-touch) and adopt clears marker

- [x] 4.1 In `src/plugins/idler/tools/ideas.ts`, make `kind` optional and add `ignore?: boolean` to `upsert_idea`'s schema
- [x] 4.2 Ignore path (`ignore: true`): read the entry via `sdk.memory.get(id)` (error if absent), snapshot `ignoredAt = entry.updatedAt`, merge `{ ignoredAt, open: false, priority: 0 }` with `{ touch: false }`; do NOT call `remember`, do NOT compute priority
- [x] 4.3 Adopt path (no `ignore`): require `kind` (error if missing); existing behavior PLUS clear any prior `ignoredAt` (so a previously-ignored entry becomes a clean tracked unit)
- [x] 4.4 Tool tests: ignore snapshots `ignoredAt` to `updatedAt` without bumping `updatedAt`; a second scan with no content change keeps it skipped (loop-prevention); a content write (`remember`) flips it to candidate; adopt clears `ignoredAt` and opens the unit; ignored entry is absent from `list_top_ideas`

## 5. Sync prompt — memory-scan rotation entry

- [x] 5.1 In `src/plugins/idler/prompts/sync.ts`, gate a memory-scan rotation entry on `config.sources.scanMemory`; add it to step 2's round-robin and to the source header lines
- [x] 5.2 Instruct: call `recall` (no query, limit 25), classify each entry — no idler slot → candidate; `plugins.idler.ignoredAt` equals `updatedAt` → skip; `ignoredAt` differs from `updatedAt` → candidate; slice without `ignoredAt` → skip (tracked unit). Act on up to 5 candidates: `upsert_idea` adopt (actionable AND allowlisted repo, conservative default-to-ignore) or `upsert_idea ignore:true`
- [x] 5.3 Sync-prompt test: includes the memory-scan entry + classification rule when `scanMemory` true; omits it when false

## 6. Verify wiring & integration

- [x] 6.1 Confirm `recall` is reachable from the sync cron session (no `requiredTools` allowlist on the sync spec)
- [x] 6.2 Run `npx tsc`, `npx oxlint` on changed files, `npx oxfmt` on changed files, and `npm test`; fix any failures

## 7. Spec sync

- [x] 7.1 After implementation passes, archive the change and sync delta specs into `openspec/specs/` per the OpenSpec workflow
