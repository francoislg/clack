## 1. Core types and schema

- [x] 1.1 Add and **export** `MemoryLink { id: string; reason: string }` (the persisted edge) and add `linkedMemories: MemoryLink[]` to the `MemoryEntry` interface in `src/memoryRegistry.ts`
- [x] 1.2 Add `linkedMemories?: MemoryLink[]` to the `RememberInput` interface
- [x] 1.3 Add and **export** the recall-time view types: `RecalledMemoryLink extends MemoryLink { archived?: { summary: string; outcome: string } }` and `RecalledMemoryEntry = Omit<MemoryEntry, "linkedMemories"> & { linkedMemories: RecalledMemoryLink[] }`; change `MemorySearchResult.entries` to `RecalledMemoryEntry[]`
- [x] 1.4 Add a permissive `memoryLinkZod = z.object({ id: z.string().default(""), reason: z.string().default("") })` and `linkedMemories: z.array(memoryLinkZod).default([])` to `memoryEntryZod` (graceful reader — never reject)

## 2. Write passthrough

- [x] 2.1 In `rememberCore`, pass `linkedMemories` through with omit-to-keep semantics (`input.linkedMemories ?? existing?.linkedMemories ?? []`), mirroring `references`
- [x] 2.2 Confirm `mergeMemoryNamespace` and `archive`/`forget` paths leave `linkedMemories` untouched (no code change expected; verify by test)

## 3. Recall: haystack and archive resolution

- [x] 3.1 Fold each link's `reason` into `entryHaystack` (append alongside reference recipe text; do NOT include link `id`s, so one entry never surfaces on a search for another's id)
- [x] 3.2 In `searchMemory`, after selecting the page, `await loadArchiveStore()` once and map each returned entry to a `RecalledMemoryEntry`: for each `linkedMemories` edge whose target `id` is absent from the active store, do an exact-id archive lookup and attach `archived: { summary, outcome }` when found; edges that are active, or neither active nor archived, are returned unchanged (no `archived` field); never throw
- [x] 3.3 Ensure the `archived` enrichment is computed per call and never written back — `rememberCore` persists only `{ id, reason }`; the mapping in 3.2 must not mutate the cached/persisted store objects (build new edge/entry objects)

## 4. Tools

- [x] 4.1 Add an optional `linkedMemories` array argument (with `id`/`reason` describe() text) to the `remember` tool schema in `src/tools/query/remember.ts` and thread it into the `RememberInput`
- [x] 4.2 Update the `remember` tool description to frame links as for semantic relationships (supersession, causation, blocking, duplication), not generic "see also"
- [x] 4.3 No change expected in `src/tools/query/recall.ts` — it passes `searchMemory`'s result through `textResult` whole, so the `archived` enrichment surfaces automatically; update its `query` describe() text to mention link `reason` is searchable, and add a test asserting the enrichment reaches the tool output

## 5. SDK surface

- [x] 5.1 Confirm `RememberInput` flows through `src/plugins/sdkMemory.ts` / `src/plugins/sdk.ts` unchanged (the new optional field requires no SDK signature change); add a test asserting a plugin can write links via `sdk.memory.remember`

## 6. Tests

- [x] 6.1 `src/memoryRegistry.test.ts`: link passthrough on create/update (omit-to-keep), legacy record reads back empty array, dangling link accepted without rejection, `plugins`/`references` preserved across a link-only update
- [x] 6.2 `searchMemory` tests: query matches on link `reason`; link `id` does NOT leak one entry into another's id search; dangling link to an archived target gains `archived: { summary, outcome }`; active-target and truly-unknown links carry no `archived` field; the cached/persisted entry is not mutated by the enrichment (re-reading the store shows the bare `{ id, reason }` edge)
- [x] 6.3 `remember` tool test: `linkedMemories` arg is accepted and persisted; `recall` tool test: returned entries carry edges (with archive annotation where applicable)

## 7. Verify

- [x] 7.1 Run `npx tsc --noEmit`, `npx oxlint` on changed files, and `npm test`
- [x] 7.2 Run `openspec validate add-memory-links --strict`
