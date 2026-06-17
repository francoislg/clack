## Context

The memory faculty (`src/memoryRegistry.ts`) persists a flat map of entries keyed by stable namespaced `id` at `data/state/memory.json`. Entries are discovered only through `recall`'s case-insensitive substring search over core text. There is no way to express that two entries are about the same thing when they don't share words. Each entry already carries a `references` array describing *external* surfaces (PRs, Sentry, Asana) with read/comment recipes; this change adds the symmetric *internal* concept — edges from one entry to another.

Constraints inherited from the faculty:
- Graceful permissive reader: a state file mismatch logs + reads as empty, never throws or wipes (`memoryEntryZod`, `loadMemoryStore`).
- All writes serialize through one write chain; `rememberCore` preserves untouched fields (omit-to-keep) and never clobbers `plugins` namespaces.
- `forget`/`archive` remove an entry without rewriting any other entry. The archive (`memory-archive.json`) is lean and retrievable only by exact `id` (`getArchived`).

## Goals / Non-Goals

**Goals:**
- Let an entry declare optional, free-text-labeled edges to other entries: `linkedMemories: Array<{ id; reason }>`.
- Keep edges cheap and consistent with the faculty's graceful philosophy — optional, permissive, dangling-tolerant, no new write coupling.
- Make links useful at recall: their `reason` text is searchable, and a link whose target has been archived resolves to its archived outcome instead of reading as dead.

**Non-Goals:**
- No typed/controlled relationship kinds (no `supersedes`/`blocks` enum) — free-text `reason` only this round.
- No automatic reverse edges and no bidirectional bookkeeping.
- No graph traversal/hydration in `recall` (it returns the raw edge list; callers chain a follow-up `recall`/`get`).
- No idler or other plugin behavior change; links are descriptive and do not feed priority.
- No data migration — the field is optional with a permissive default.

## Decisions

**Edge shape: `{ id: string; reason: string }`, on a new core field `linkedMemories`.**
It mirrors `references` (an array of small typed objects) and lives in core, not a plugin namespace, because "relate any two entries" is universal — ids are the shared currency across plugins. `reason` defaults to `""` in the zod schema (permissive), matching `referenceZod`'s field defaults. Alternative considered: a separate top-level adjacency file (`memory-links.json`). Rejected — it splits ownership of an entry across two files and breaks the "entry owns its own data" model that makes serialized single-file writes safe.

**One-directional, owner-stored.** An entry stores only its outbound links. This needs zero changes to write semantics — `rememberCore`'s omit-to-keep passthrough handles it like any other field. "What links to me?" is a reverse scan over `listMemory()`, addable later without a schema change. Alternative considered: auto-writing a reverse edge on the target. Rejected — the reverse `reason` is never the same sentence ("root cause of" ⇄ "caused by"), and it would force `remember` to mutate a *second* entry, breaking single-entry write atomicity and creating a consistency burden on `forget`/`archive`.

**No write-time validation; dangling-tolerant.** `remember` accepts a link to an `id` that does not (yet) exist and never rejects. This is consistent with `mergeMemoryNamespace` being the *only* core-first operation (a slice is meaningless without an entry, but an edge is not) and with the graceful-reader stance everywhere else. Alternative considered: reject links to unknown ids (like `MemoryEntryNotFoundError`). Rejected — it forbids forward links and makes the link fragile to the target's lifecycle; you'd lose the link exactly when the target is archived, which is the most useful time to keep it.

**Recall resolves dangling outbound links against the archive — via a recall-time view type, never the persisted shape.** The persisted edge type is `MemoryLink { id: string; reason: string }` and that is *all* that is ever written to `memory.json`. The archive annotation is a **read-time enrichment** that lives only in `searchMemory`'s return, on a distinct view type:

```ts
interface MemoryLink { id: string; reason: string }                       // persisted
interface RecalledMemoryLink extends MemoryLink {
  archived?: { summary: string; outcome: string };                        // recall-time only
}
type RecalledMemoryEntry = Omit<MemoryEntry, "linkedMemories"> & {
  linkedMemories: RecalledMemoryLink[];
};
// MemorySearchResult.entries becomes RecalledMemoryEntry[]
```

When `recall` returns an entry, `searchMemory` maps each `linkedMemories[]` edge: if the target `id` is present in the active store it is returned unchanged; otherwise it does an exact-id `getArchived` lookup and, when an archived record exists, attaches `archived: { summary, outcome }` to that edge's view. Truly-unknown ids are returned as-is (no error). The `archived` field is computed per call and is never persisted — `rememberCore` only ever writes `{ id, reason }`. This keeps the persisted shape clean while making the recall result self-describing.

Surfacing it as a view superset (not a projection) satisfies the existing spec requirement that `recall` return the **complete** entry, not a projection — the view *adds* a field, never drops one. `searchMemory` is already `async` and already `await`s `loadMemoryStore()`, so it can `await loadArchiveStore()` once per call; the per-edge lookups are then cache-backed in-memory map reads (no I/O, no fetch), bounded by the naturally-small link count per entry. `recall.ts` passes `searchMemory`'s result through `textResult` unchanged, so no tool-layer projection change is needed — the annotation surfaces automatically.

**`reason` folded into the search haystack.** `entryHaystack` (line ~363) appends each link's `reason` so a query can match on the relationship text, the same way it already folds in reference recipes. Edge `id`s are *not* added to the haystack to avoid one entry surfacing on a search for another's id.

**Archive record stays lean.** `ArchivedMemory` does not gain links — an archived entity is terminal, and edges are live-work navigation. This matches the existing decision to shed `references` and `plugins` on archive.

## Risks / Trade-offs

- **[Junk-drawer "see also" links dilute value]** → The spec and tool description frame links as for *semantic* relationships (supersession, causation, blocking, duplication) that search can't infer, not generic similarity (which keyword recall already covers).
- **[Dangling links accumulate as targets are forgotten]** → Tolerated by design. They cost nothing structurally; recall resolves the archived ones and returns the rest unchanged. A future daily-review step could prune truly-unknown ids, but that is out of scope here.
- **[Recall archive-resolution adds a per-link lookup]** → Lookups hit the cache-backed in-memory archive map (no I/O per link beyond the one-time load), and the link count per entry is small; negligible.
- **[Cycles (A↔B)]** → Harmless because recall does not hydrate/traverse — it returns the raw edge list one level deep. If hydration is ever added, it must carry cycle detection; flagged as a non-goal here.

## Migration Plan

None required. `linkedMemories` is optional with `default([])` in the permissive schema, so every existing `memory.json` record loads unchanged and reads back an empty edge list. Rollback is removing the field; old records are unaffected and any links written in the interim are simply ignored by the prior code (graceful reader drops unknown fields).

## Open Questions

- Should the daily relevance review eventually prune outbound links whose target is neither active nor archived? Deferred — not needed for v1 and adds a write path to the review.
- If free-text `reason` proves noisy in practice, promote the most common phrasings to an optional typed `kind` alongside `reason` in a follow-up change.
