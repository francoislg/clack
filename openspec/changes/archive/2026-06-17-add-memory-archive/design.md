## Context

The memory faculty (`src/memoryRegistry.ts`) holds an active working set at `data/state/memory.json`: full entries with `references[]` recipes and `plugins.<name>` namespace bags, keyword-searchable via `recall`, pruned by a daily Claude-powered review. The review's only terminal action is `forget(id)` — a hard `delete store[id]`. The daily-review prompt (`src/memory/dailyReview.ts`) calls `forget` when "referenced work resolved/closed AND staleAfter passed." So the moment a Sentry issue is fixed, the record — including the outcome and the resolving PR — evaporates.

The idler's sync (`src/plugins/idler/prompts/sync.ts`) dedups re-emitted entities "by stable key," but only against *live* entries (`idler-ideas-ledger` spec). Once an entry is forgotten, a recurrence (a regression, a re-opened task) is re-triaged from zero with no memory of the prior outcome. Outcome data is lost on every daily review starting now.

The fix is a second, lean, terminal store keyed by the same stable `id`, retrievable only by exact id, consulted on discovery. It clones the active store's file + zod + `writeChain` idioms rather than inventing storage.

## Goals / Non-Goals

**Goals:**
- Stop losing outcome data: a done-but-worth-remembering entry leaves a durable "what happened" note instead of vanishing.
- Keep the active recall surface clean: the archive is invisible to keyword `recall` — only an exact-id point lookup reaches it.
- Bounded and cheap: lean notes (no recipes, no namespace bags) + age-horizon prune keep the archive small and self-maintaining, with no fetch and no Claude needed to prune.
- Enrich, don't suppress: a re-discovered entity stays workable; the archived outcome is context for triage, not a gate.
- Zero new dependencies; reuse the file + zod + `writeChain` stack.

**Non-Goals:**
- Keyword/date/paginated search over the archive (deliberately omitted — that is the active store's job; searchable history would re-pollute the working set).
- A `plugins` namespace bag on archived records (terminal records carry no live execution state).
- A Home Tab UI for browsing the archive (later, if wanted).
- Re-fetching archived references (archived = terminal; never re-polled).

## Decisions

### D1: Single keyed JSON map at `data/state/memory-archive.json`, not per-file — living in `src/memoryRegistry.ts`
The exploration started at "one file per id" on the assumption the archive grows unbounded. Two later decisions removed that premise: records are **lean** (~200 bytes) and **age-pruned** (D4). A bounded, small store has no reason to diverge from the house convention (`memory.json`, `users.json`, `workers.json`). Reuse the exact graceful-permissive-reader + serialized-`writeChain` + in-memory-cache pattern. ID-only retrieval is just `archiveStore[id]` — no id→filename encoding, no new I/O layer. The archive store, cache, and its `getArchived`/`archive`/`pruneArchive` functions live **in `src/memoryRegistry.ts` itself — not a sibling module** — so they share that module's single private `writeChain`/`serialize`; this is what makes the cross-store atomicity in D3 mechanically true (a sibling file would have its own write chain and could not serialize against the active store's writes). Test code may still split into a focused `memoryArchive.test.ts` that imports these functions. **Alternatives:** per-id files (rejected: convention divergence + encoding cost for no gain at this scale); a sibling `memoryArchive.ts` module (rejected: separate module-private `writeChain` breaks D3 atomicity); a `plugins.idler`-style namespace on archived records (rejected: terminal records hold no execution state).

### D2: Lean record shape — `{ id, summary, outcome, link?, archivedAt }`
An archived record sheds everything that exists to drive *live* work. No `references` recipes (`howToRead`/`howToComment` exist to re-poll; archived entries are never re-polled) and no `plugins` bag (execution state is gone). It keeps just enough to answer "did we do this, and what happened": `summary` (one line of what it was about), `outcome` (the resolution — "Fixed in PR #123, merged 2026-06-10"), an optional bare `link`, and `archivedAt`. Claude composes `summary`/`outcome` from the re-fetched status at review time (D3), so the note reflects the final known state. Validated by a permissive zod schema (graceful reader): a malformed file logs + reads as empty, never wipes.

### D3: `archive(id, leanNote)` is an atomic distill-and-remove, veto-aware
A new registry op (and a dev+/system-cron tool in `src/tools/query/`) writes the lean record to the archive **and** removes the active entry in one serialized step, so the entry is never in both stores or neither. Because removal destroys active state, `archive` consults the **same** pre-expire hooks as `forget` (`registerBeforeExpire`): any hook returning `vetoed: true` (or throwing — treated as a veto) retains the active entry and writes **no** archive record. This preserves the faculty's invariant: state is never destroyed against a plugin's veto. Implementation rides the existing `serialize(...)` write chain — the **same** module-private chain the active-store writes use, which is why D1 mandates the archive live in `memoryRegistry.ts`: both the archive `persist` and the active-store removal happen inside one serialized closure, so a throw in either rejects the closure and neither store ends mid-mutation. **Alternative:** two steps (`rememberArchived` then `forget`) — rejected: non-atomic, leaves a window where an entry is in both stores or a veto half-applied.

### D4: Pruning is mechanical age-horizon, run as a daily-review step
`pruneArchive(now)` drops records whose `archivedAt` is older than `archiveRetentionDays` (default 365). Pure date comparison — no fetch, no Claude, no veto (the record is already terminal). It is exposed as a `prune_archive` MCP tool (dev+/system-cron, in `src/tools/query/`) that the daily-review prompt calls as its final step after the active walk — the mechanics live in the tool, Claude just invokes it. The review is already Claude-driven over MCP tools, so this adds no new cron infrastructure. Lean + age-pruned keeps the archive bounded without operator attention. **Alternatives:** a per-fire code hook on the review cron (rejected: the cron is a generic prompt runner with no code callback today); Claude-judged archive relevance (rejected: archived records are terminal; there is nothing to re-judge, and a fetch would be wasted).

### D5: The daily review's decision goes three-way
The review prompt (`dailyReview.ts`) changes from keep-or-forget to: *still relevant* → leave/refresh; *done & worth remembering* → distill + `archive(id, leanNote)`; *noise* → `forget(id)` (unchanged true delete). The review already re-fetches each reference's `howToRead` before judging, so it has the current status in hand to compose the lean note. Then it runs the archive prune step (D4). `forget` semantics for noise entries are untouched.

### D6: Idler sync consults the archive on discovery — enrich, not suppress
Before `upsert_idea` creates a unit for an entity with no live memory entry, sync calls `getArchived(id)` by the same stable key. On a hit, it enriches the new/refreshed unit's `what`/`whereWeAre` with the prior outcome ("fixed before in PR #123") and proceeds — it does **not** skip the entity. Rationale: a re-alerting/regressing entity usually *is* new work; the prior outcome is context that makes triage start informed, not a veto that silently drops a genuine regression. The idler sync is a Claude-driven cron prompt, so it reaches the archive through a new `get_archived(id)` MCP read tool (dev+/system-cron, in `src/tools/query/`) — `recall` is keyword/date search over the **active** store only and cannot serve an exact-id point lookup, so no existing tool covers this. `getArchived(id)` is also added to the registry (and may be surfaced on `sdk.memory` for symmetry), but the driving consumer reaches it via the tool. **Alternative:** suppress on archive hit (rejected: silently ignores regressions — the dangerous failure mode).

### D7: `archiveRetentionDays` as a module constant, matching the shipped `DEFAULT_REVIEW_TIMEZONE` precedent
There is no `memory` config block in `config.ts` today — the shipped memory faculty deliberately made the review timezone a module constant (`DEFAULT_REVIEW_TIMEZONE`) with config "layered later." Follow that precedent exactly: `DEFAULT_ARCHIVE_RETENTION_DAYS = 365` in `memoryRegistry.ts`, used as the default of `pruneArchive(now, retentionDays = DEFAULT_ARCHIVE_RETENTION_DAYS)`. "Configurable" is satisfied by the overridable parameter (the same sense the codebase already uses); a `config.json` knob can be layered later without changing the contract. No per-namespace horizons in v1. **Alternative:** introduce a new `config.memory` zod block now (rejected: invents a config surface the codebase doesn't yet have, diverging from the just-shipped faculty's own precedent).

## Risks / Trade-offs

- **Cross-store atomicity** → `archive` must write the archive and remove the active entry without an interleaved failure. Mitigation: both writes happen inside one `serialize(...)` closure on the shared write chain; if the second `persist` throws, the closure rejects and neither store ends mid-mutation (whole-object `JSON.stringify` writes, no partial maps). A temp-file+rename hardening is available but deferred to match the active store's plain-`writeFile` convention.
- **Stale outcome text** → `outcome` is a point-in-time snapshot composed at archival; it is never refreshed. Acceptable: it is a historical note, not a live status. A consumer wanting current status re-fetches the source by `link`.
- **Archive miss on key drift** → if an entity's stable key changes between active life and recurrence (e.g. `worker:<branch>` re-keyed to `pr:<number>`), `getArchived` by the new key misses. Accepted for v1: archival should use the most stable key available (the source-entity id), same discipline the active store already requires.
- **Loss window for manually forgotten entries** → `forget` stays a true delete, so a manual/noise forget writes no archive record. Intended: only the reviewed, done-but-worth-remembering path distills. Manual delete being destructive is a feature.

## Migration Plan

1. Ship the archive store (`memory-archive.json` reader/writer/cache), `getArchived`/`archive`/`pruneArchive` in the registry, and the `archive` query tool — additive, no behavior change yet.
2. Update the daily-review prompt to the three-way decision + archive-prune step (`dailyReview.ts`).
3. Update the idler sync prompt to consult `getArchived` on discovery (enrich path).
4. Add `archiveRetentionDays` (default 365) to config.
5. **No data migration**: the archive starts empty and fills as the daily review runs. **Rollback:** all code is additive; reverting the prompt changes returns to pure-`forget` behavior, and `memory-archive.json` can be left in place (nothing reads it once the prompts revert).

## Open Questions

Resolved during exploration (recorded for traceability):
- **Storage shape** → single keyed map, not per-file (D1) — the "one file per id" instinct was driven by an unbounded-growth assumption that lean + age-prune removed.
- **Does `archive` honor the veto hook?** → yes, same as `forget` (D3) — never destroy active state against a plugin's veto.
- **Suppress or enrich on archive hit during sync?** → enrich (D6) — suppressing would silently drop regressions.

Still open (non-blocking):
- Should the morning idler summary surface "re-discovered N previously-resolved entities" so a human sees regressions? (Leaning: yes, but out of scope for v1 — the enriched unit already flows through normal triage/summary.)
- Per-namespace retention horizons later, or is one global `archiveRetentionDays` enough? (Leaning: one global knob for v1.)
