## 1. Archive store (registry)

- [x] 1.1 Add the lean record type `ArchivedMemory` (`id`, `summary`, `outcome`, optional `link`, `archivedAt`) and its permissive zod schema + store map schema (graceful reader: missing/malformed → empty map, log, never wipe). Place it **in `src/memoryRegistry.ts`** (NOT a sibling module) so the archive functions reuse that module's private `writeChain`/`serialize` — required for the cross-store atomicity in 1.4.
- [x] 1.2 Add `data/state/memory-archive.json` load/persist with an in-memory cache, mirroring `loadMemoryStore`/`persist`.
- [x] 1.3 Implement `getArchived(id): Promise<ArchivedMemory | null>` (exact-id point read; no search variant).
- [x] 1.4 Implement `archive(id, leanNote)` as an atomic distill-and-remove inside ONE `serialize(...)` closure on the module's shared write chain: consult the pre-expire hooks (same path as `forgetMemory`) — on veto/throw, retain the active entry and write NO archive record; otherwise write the lean record and remove the active entry (core + every `plugins` slice) in the same closure so a throw in either persist leaves neither store mid-mutation.
- [x] 1.5 Implement `pruneArchive(now): Promise<string[]>` — mechanical: drop records whose `archivedAt` is older than `archiveRetentionDays`; no fetch, no veto. Return the pruned ids.
- [x] 1.6 Extend `clearMemoryCache` (or add `clearArchiveCache`) to reset the archive cache + write chain for tests.

## 2. Retention horizon

- [x] 2.1 Add `DEFAULT_ARCHIVE_RETENTION_DAYS = 365` as a module constant in `memoryRegistry.ts` (matching the shipped `DEFAULT_REVIEW_TIMEZONE` precedent — no `config.memory` block exists yet). `pruneArchive(now, retentionDays = DEFAULT_ARCHIVE_RETENTION_DAYS)` takes it as an overridable param.

## 3. Archive query tools

- [x] 3.1 Add an `archive` tool in `src/tools/query/` (dev+, system-cron permitted) that calls the registry `archive(id, leanNote)`. Tool description + args stay English (via-Claude path). Wire it into `src/tools/server.ts` gating alongside `remember`/`forget`.
- [x] 3.2 Add a `get_archived` tool in `src/tools/query/` (dev+, system-cron permitted) that calls `getArchived(id)` and returns the lean record or null — `recall` is keyword/date search over the active store and cannot serve an exact-id point lookup, so this is a distinct tool. Wire it into `src/tools/server.ts` gating. The idler sync prompt reaches the archive through this tool.
- [x] 3.3 Add a `prune_archive` tool in `src/tools/query/` (dev+, system-cron permitted) that calls `pruneArchive(now)` and returns the pruned ids. Mechanics live in the tool; the daily-review prompt invokes it as its final step.

## 4. Daily review three-way decision

- [x] 4.1 Update `REVIEW_PROMPT` in `src/memory/dailyReview.ts` to the three-way decision: still-relevant → leave/refresh; done & worth remembering → distill a lean note and call `archive(id, leanNote)` — composing `summary` (≤1 line, what it was about), `outcome` (the resolution, e.g. "Fixed in PR #123, merged <date>" / "Abandoned: dupe of <id>"), and optional `link` (bare URL, omit if none) from the re-fetched status; noise → `forget(id)`. Include 2–3 examples so composition is consistent. A failed reference fetch keeps the entry live (never archive on a failed fetch), matching the existing rule.
- [x] 4.2 Add the final step to `REVIEW_PROMPT`: after the active walk, call the `prune_archive` tool (3.3) to drop archived records past `archiveRetentionDays`.

## 5. Idler sync enrich

- [x] 5.1 Update `buildSyncPrompt` in `src/plugins/idler/prompts/sync.ts` so discovery consults `getArchived(id)` by the stable key BEFORE `upsert_idea` for an entity with no live entry; on a hit, enrich the new/refreshed unit's `what`/`whereWeAre` with the prior outcome and proceed (do NOT suppress).

## 6. Tests

- [x] 6.1 Registry unit tests in a new `src/memoryArchive.test.ts` (importing the archive functions from `memoryRegistry.ts`, mock-deps pattern): lean shape round-trip; malformed file reads as empty; `getArchived` exact-id hit/miss; `archive` writes record + removes active entry; `archive` veto retains active entry and writes nothing; `pruneArchive` drops past-horizon and keeps within-horizon; `archive` is invisible to `recall` (active-store search unaffected).
- [x] 6.2 Tool unit tests (mock the registry boundary): `archive`, `get_archived`, and `prune_archive` each call their registry fn and are role-gated dev+ with system-cron permitted.
- [x] 6.3 Run `npx tsc`, `npx oxlint`, `npx oxfmt --check`, and `npm test`.

## 7. Verify

- [x] 7.1 `openspec validate add-memory-archive --strict`.
