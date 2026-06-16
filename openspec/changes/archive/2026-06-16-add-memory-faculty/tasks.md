## 1. Core memory store (`src/memoryRegistry.ts`)

- [x] 1.1 Create `src/memoryRegistry.ts` modeled on `userRegistry.ts`: `MemoryEntry` type (`id`, `what`, `why`, `staleAfter?: { date?: string; reason?: string }`, `nextSteps?`, `references[]`, `createdAt`, `updatedAt`, `plugins?`), permissive `memoryEntryZod` with `plugins` as opaque `z.record(z.string(), jsonObject)` passthrough, keyed-map `memoryStoreZod`, in-memory `cached`, and the serialized `writeChain`.
- [x] 1.2 Implement reads: `loadStore`, `getMemory(id)`, `listMemory()`, `getMemoryNamespace(plugin, id)`, and `searchMemory({ query?, from?, to?, limit?, offset? })` (case-insensitive substring over core text + `updatedAt` range filter, sorted newest-first, returning `{ total, limit, offset, entries }` with whole entries incl. `plugins`).
- [x] 1.6 Stamp `createdAt` once at creation and `updatedAt` on every write.
- [x] 1.3 Implement writes (all through `serialize`): `rememberCore(entry)` (preserves existing `plugins`), `mergeMemoryNamespace(plugin, id, partial)` rejecting unknown-`id` (core-first, no placeholder), `forgetMemory(id)` (record-level delete).
- [x] 1.4 Implement `persist` to `data/state/memory.json` (match `userRegistry` write style) and `clearMemoryCache()` for tests.
- [x] 1.5 Unit tests: graceful read (missing/malformed → empty), serialized concurrent writes don't lose updates, unknown plugin slice survives a core write, core-first merge rejection, `searchMemory` keyword match + date-range filter + pagination (`total`/page) returning full entries.

## 2. Expiry + pre-expire hook

- [x] 2.1 Add `staleAfter` object shape (`{ date?: string ISO; reason?: string }`) and a `pruneExpired(now)` sweep that deletes entries whose `staleAfter.date` has passed via `forgetMemory`; entries with no `date` are never auto-pruned.
- [x] 2.2 Add a pre-expire hook registry (`onBeforeExpire(fn)` on the registry/SDK): before deleting an entry with a `plugins.<name>` slice, consult hooks; each returns `{ vetoed, extendUntil? }`; any veto retains, `extendUntil` sets `staleAfter.date`, a throwing hook fails safe (veto). Entries with no plugin slice skip hooks.
- [x] 2.3 Unit tests: stale entry with no slice prunes without a hook; entry with a slice consults the hook; veto/extend retains the entry.

## 3. SDK surface (`src/plugins/sdkMemory.ts` + `sdk.ts`)

- [x] 3.1 Create `src/plugins/sdkMemory.ts` mirroring `sdkUsers.ts`: `createMemorySurface(deps, pluginName, warn)` returning `get`/`list`/`recall` (core) and `data(schema)` → `{ get(id), merge(id, partial) }` auto-scoped to `pluginName`, parsing the slice with the plugin's schema (warn+null on mismatch).
- [x] 3.2 Wire `sdk.memory` into `src/plugins/sdk.ts` (type `ClackSdkMemory` + `ClackSdkMemoryData<T>`); expose `sdk.memory.onBeforeExpire(fn)` for plugin hook registration.
- [x] 3.3 `sdkMemory` exercised end-to-end via the idler tools test (`createMemorySurface` over an in-memory backing): namespaced merge/get round-trip + core-first rejection. (Slice-schema-mismatch→null is covered at the registry layer in `memoryRegistry.test.ts`.)

## 4. `remember` / `recall` query tools

- [x] 4.1 Add `remember` (create/update by `id`) and `recall` (keyword + `from`/`to` + `limit`/`offset`, returns full entries incl. `plugins`) tools under `src/tools/query/`, calling the core registry; English tool descriptions/results (via-Claude path).
- [x] 4.2 Register both at minRole `dev` in `src/tools/server.ts` (the `"system"` cron role passes `meetsMinimumRole` automatically — no special-case branch).
- [x] 4.3 Tests: dev+ can write, member cannot; `recall` keyword/date/pagination behavior; result includes plugin data.

## 5. Daily relevance review + worker tagging

- [x] 5.1 Schedule a core `systemActor` cron via `createJob` (`createdBy: null`, `systemActor: "memory"`, channelless, `submitResponseMode: "skipped"`, `0 0 * * *`) at boot; timezone from the `DEFAULT_REVIEW_TIMEZONE` constant (`"America/Toronto"`; a `config.memory.reviewTimezone` override is deferred to avoid config-schema churn in v1); reconcile idempotently on restart (match by `systemActor` + specKey). Runs silently (no digest in v1).
- [x] 5.2 Author the review prompt: paginate `recall` over all entries; for entries with `references`, re-run `howToRead`; judge relevance vs `staleAfter`; update `staleAfter`/`what` or `forget(id)` (hook-enforced). Notes judged on date/rationale only.
- [x] 5.3 Append the tagging instruction to `EXECUTION_SYSTEM_PROMPT` (`src/changes/execution.ts`): on task start, `remember` an entry keyed `worker:<branch>` (or `pr:<n>`) describing the work.
- [x] 5.4 Tests: review forgets a stale unreferenced note; review consults the hook for a slice-bearing entry; cron job is registered once.

## 6. Idler migration to memory namespace

- [x] 6.1 Define `idlerSlotSchema` in a new idler core module (`priority`, `kind`, `open`, `whereWeAre`, `cursorsByRefId: Record<string,string>`) and a thin accessor over `sdk.memory.data(idlerSlotSchema)`.
- [x] 6.2 Retire `src/plugins/idler/ledger.ts`; rewrite `tools/ideas.ts` (`list_top_ideas`/`upsert_idea`/`reprioritize_idea`) to read/write core memory + the idler slice; keep `priority.ts` computing the score.
- [x] 6.3 Rewrite `prompts/sync.ts`: discovery `remember`s the core entry (with `references` recipes + estimated `staleAfter`) before merging the idler slice. Sync no longer prunes — drop any prune step (the core daily review owns relevance/expiry).
- [x] 6.4 Rewrite `prompts/work.ts`: select the top entry carrying an idler slice via `sdk.memory`, re-read references before acting, write the step back into the slice. Leave `activity.ts`/`activity.json` unchanged.
- [x] 6.5 Register the idler pre-expire hook (veto/extend when the slice references an open PR).
- [x] 6.6 Update idler tests (`ledger.test.ts` → memory-slice tests; `tools.test.ts`, prompt tests) for the new storage.

## 7. Boot migration

- [x] 7.1 Scaffold a blocking migration with `/create-migration`: read the single global `data/plugins/idler/ideas.json` (not per-repo); for each unit, write a `data/state/memory.json` entry (id = the unit's existing namespaced `source:key`, `what`, `references` recipes, `createdAt`/`updatedAt`) + a `plugins.idler` slice (`priority`, `kind`, `open`, `whereWeAre`, `cursorsByRefId` built from each reference's `cursor`); rename `ideas.json` → `ideas.json.migrated`.
- [x] 7.2 Migration tests (happy path, empty/missing ledger, idempotent re-run) registered in the test runner.

## 8. Verify

- [x] 8.1 `npx tsc` clean; `npx oxlint` + `npx oxfmt --check` on touched files; full `npm test` green.
- [x] 8.2 `openspec validate add-memory-faculty --strict` passes; reconcile any spec drift discovered during implementation.
