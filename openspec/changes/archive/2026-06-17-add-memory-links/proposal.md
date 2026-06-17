## Why

Memory entries are findable only by keyword search, so two entries are "related" only when they happen to share words. Relationships that matter — supersession, causation, blocking, duplication — are often *semantic, not lexical* (e.g. `note:deploy-needs-node-22` is the root cause of `sentry:1234` with no shared keywords). An explicit, optional edge between entries lets the memory faculty express those relationships directly and lets a recall surface "see also" context that search would never connect.

## What Changes

- Add an optional core field `linkedMemories: Array<{ id: string; reason: string }>` to `MemoryEntry`, parallel to the existing `references` array. `references` points *out* of the system (PRs, Sentry, Asana); `linkedMemories` points *across* it (memory → memory). The store becomes a directed graph with free-text edge labels.
- Edges are **one-directional** (an entry owns only its own outbound links). No reverse edge is written or required; "what links to me?" is answerable by a reverse scan at recall time if ever needed.
- Edges are **not validated at write time** and are **dangling-tolerant**: linking to a not-yet-created or later-removed `id` is allowed. This matches the faculty's graceful-reader philosophy and is consistent with `forget`/`archive` not rewriting other entries.
- `recall` folds each link's `reason` into the searchable haystack, and resolves an outbound link whose target is no longer active against the archive (exact-id lookup), so a link to an archived entry surfaces its outcome rather than reading as dead.
- The `remember` tool gains an optional `linkedMemories` argument; `rememberCore` passes it through (omit-to-keep, same as other core fields).
- Free-text `reason` only — no typed/controlled relationship kinds in this change.
- The lean archive record (`ArchivedMemory`) does **not** carry links — it stays terminal and lean, unchanged.
- No plugin behavior changes. The idler does not consume links; edges are descriptive and do not feed priority.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `memory-faculty`: the core record shape gains an optional `linkedMemories` edge array; the `remember` tool accepts it; `recall`'s keyword haystack includes link `reason` text and resolves dangling outbound links against the archive.

## Impact

- `src/memoryRegistry.ts` — `MemoryEntry` interface + `RememberInput`, `memoryEntryZod` (new permissive `linkedMemories` array, `default([])`), `rememberCore` passthrough, `entryHaystack` (fold in `reason`), and recall-time archive resolution for dangling links.
- `src/tools/query/remember.ts` — new optional `linkedMemories` tool arg + description.
- `src/tools/query/recall.ts` — surface resolved/dangling link state in results (if any projection change is needed).
- `src/plugins/sdkMemory.ts` / `src/plugins/sdk.ts` — `RememberInput` flows through unchanged; no SDK surface change beyond the new optional field.
- No migration required: the field is optional with a `default([])` permissive read, so existing `data/state/memory.json` records load unchanged.
- Tests: `memoryRegistry` unit tests (passthrough, dangling tolerance, haystack, archive resolution), `remember`/`recall` tool tests.
