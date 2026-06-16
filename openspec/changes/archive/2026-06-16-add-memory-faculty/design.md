## Context

The idler plugin persists work in `data/plugins/idler/ideas.json` (`src/plugins/idler/ledger.ts`), where one `IdlerUnit` carries both durable knowledge (`what`, `source`, `references[]` recipes) and execution bookkeeping (`open`, `priority`, `whereWeAre`, `nextSteps`, per-reference `cursor`). Consequences: knowledge dies when the idler is disabled, nothing expires, and Clack cannot record an observation outside a cron fire.

The codebase already solves the "core record + plugin-owned extension" problem for users: `data/state/users.json` is a single keyed map where each record has core identity fields plus a `plugins.<name>` namespace bag, validated permissively, mutated through a serialized `writeChain`, and exposed to plugins as `sdk.users.data(schema)` (`src/userRegistry.ts`, `src/plugins/sdkUsers.ts`). Memory is the same shape with an added expiry dimension. This design clones that proven pattern rather than inventing storage.

## Goals / Non-Goals

**Goals:**
- A core, plugin-agnostic memory store any session can read/write — Clack's notebook for *any* worth-remembering information (facts, decisions, reminders, entity context), not just tasks.
- Fast, paginated keyword + date-range search that returns whole entries (including plugin namespace data).
- A daily review that keeps memory relevant — re-fetch referenced info, judge expiry — so the store doesn't rot.
- Cleanly separate durable knowledge (core fields) from per-plugin execution state (namespace slot).
- Atomic "expire the whole task at once" via record-level delete, gated by a pre-expire veto so in-flight work isn't orphaned.
- Retire the idler's bespoke ledger; the idler becomes memory's first consumer.
- Zero new dependencies; reuse the file + zod + `writeChain` stack.

**Non-Goals:**
- Semantic/vector search. `recall` is keyword/substring (plus a date-range filter) over the in-memory map; embeddings are out of scope.
- A Home Tab UI for browsing memory (later, if wanted).
- Moving the idler's `activity.json` digest log (cross-entity, cleared nightly — stays an idler file).
- Multi-process durability hardening (Clack is single-process; the `writeChain` already serializes writes).

## Decisions

### D1: Single keyed JSON map at `data/state/memory.json`, not per-file
Mirror `users.json`. Earlier exploration weighed one-file-per-entry (smaller corrupt-write blast radius, `unlink`-as-expiry), but the keyed-map + `writeChain` template already delivers atomic record-level delete (`delete map[id]` drops the core record *and* every namespace slot in one op) and the in-process serialize that defuses lost-update races. Per-file would diverge from the house convention (`users.json`, `roles.json`, `workers.json`) for no net gain at this scale (dozens–low-hundreds of entries). **Alternatives:** per-entry files (rejected: convention divergence, id→filename encoding cost); JSONL (rejected: the bank is update-heavy — the idler patches its slot every fire — and JSONL is append-mostly); SQLite (rejected: new dependency, breaks the file+zod grain).

### D2: Core fields vs plugin namespace — split by "would a human want it on `recall`?"
Core record: `id`, `what`, `why`, `staleAfter`, optional `nextSteps`, `references[]` (durable `howToRead`/`howToComment` recipes), plus `createdAt`/`updatedAt` bookkeeping. `staleAfter` is a structured object `{ date?: string /* ISO 8601 */; reason?: string }` — the optional ISO `date` is machine-enforceable by the prune; the optional `reason` is advisory free text. An entry with no `staleAfter.date` is never auto-pruned (the daily review judges it on `reason`/context). Plugin slot (`plugins.idler`): `priority`, `kind`, `whereWeAre`, and a `cursorsByRefId: Record<string, string>` map (reference id → cursor). The cursor is the subtle one — it lives *on* references today, but it is pure execution idempotency, so it moves into the idler slot keyed by reference id; the recipe stays in core. Core validates its own fields and treats `plugins` as opaque passthrough (`z.record(z.string(), jsonObjectZod)`, exactly `userRecordZod`); each plugin re-parses its slot with its own schema on read (the documented exception to "no blind blobs" — same as `sdk.users.data`).

### D3: `sdk.memory` mirrors `sdk.users`
`sdk.memory.get(id)` / `list()` / `recall(args)` expose core entries; `sdk.memory.remember(input)` creates/updates core fields; `sdk.memory.data(schema)` returns `{ get(id), merge(id, partial) }` auto-scoped to the plugin name; `sdk.memory.onBeforeExpire(fn)` registers the pre-expire hook. The idler defines `idlerSlotSchema` in-plugin (plugin rule #3: types stay in the plugin), and core never knows the shape. New SDK capability is added deliberately, not bypassed (plugin rule #2). **The surface deliberately has NO delete**: plugins signal "done" by setting a short `staleAfter.date` grace window via `remember`, and only the core daily review actually deletes — so an entry isn't forgotten right after work finishes, leaving a window to resurrect it if work resumes. A core `forget` *tool* (role-gated, used by the review and admins through the tool layer) still exists; it is just not on the programmatic plugin surface.

### D4: Expiry = daily review + pre-expire veto hook
The canonical relevance/prune pass is the **daily midnight review** (D7), not a per-plugin sweep. It deletes entries whose `staleAfter` date has passed (`staleAfter` = optional ISO date, machine-enforceable, + free-text rationale, advisory). A mechanical `pruneExpired(now)` helper in the registry does the date check; the review orchestrates it (and the richer "re-fetch and judge" step). Before deleting an entry that has any plugin namespace slot, core consults the registered pre-expire hooks. A hook is a synchronous callback a plugin registers on the SDK (`sdk.memory.onBeforeExpire(fn)`), receiving the full entry and returning `{ vetoed: boolean; extendUntil?: string /* ISO */ }`. Resolution: **any** hook returning `vetoed: true` retains the entry; if a hook returns `extendUntil`, core sets `staleAfter.date` to it atomically with the retain; a hook that **throws** is treated as a veto (fail-safe — never destroy state on a buggy hook). Entries with no plugin slot skip the hook entirely. The idler therefore no longer runs its own prune — it just registers the hook (veto/extend when its slice references an open PR). **Alternative:** hard-drop with no hook (rejected: atomic expiry becomes atomic data loss when a task is mid-flight; the whole point of the namespace bag is that the plugin's state rides along, so it must get a say before that state is destroyed).

### D5: `merge` is core-first (no placeholder records)
Unlike `mergeUserNamespace`, which auto-creates a placeholder user, `sdk.memory.data().merge(id, …)` on an unknown `id` is rejected — a plugin slot with no knowledge record is meaningless. The idler always `remember`s the core entry (during discovery) before attaching its slot. This keeps memory entries self-describing and prevents orphan slots.

### D6: `remember`/`recall` gating
`remember` and `recall` are registered at minRole `dev` in `src/tools/server.ts`. The system cron actor passes automatically: a cron firing sets `roleOverride: "system"` (`cronScheduler.ts`), and `"system"` is the top of the `UserRole` order (`roles.ts`), so `meetsMinimumRole("system", "dev")` is true — no special-case branch needed (this is exactly how the idler/daily-review crons reach the tools). Plugin slot writes via `sdk.memory.data().merge()` are internal SDK calls with no role gate (the idler patches `plugins.idler` from its system-actor cron). Writing is namespaced to provenance via the `id` prefix; member-level users get neither tool.

### D7: `recall` search shape — keyword + date range + pagination, full-record return
`recall(query?, from?, to?, limit?, offset?)`: case-insensitive substring match of `query` against core text fields (`id`, `what`, `why`, `nextSteps`, reference text); `from`/`to` filter on `updatedAt` (ISO bounds, either side optional); results sorted newest-`updatedAt` first; pagination via `limit` (default e.g. 20) + `offset`, returning `{ total, limit, offset, entries }`. Each returned entry is the **whole `MemoryEntry`, including its `plugins` namespace bag** — callers (Claude, plugins) often need the plugin state alongside the knowledge, and the result is Claude-/dev-facing so there's no projection concern. Operates on the in-memory cache (no I/O per query). **Alternative:** a projected/core-only result (rejected: the user explicitly wants the full schema incl. plugin data; a projection would force a second round-trip).

### D8: Daily relevance review = core `systemActor` cron, Claude-powered
A core cron job created via `createJob` (`createdBy: null`, `systemActor: "memory"`, channelless, `submitResponseMode: "skipped"`, `0 0 * * *`) drives a Claude session whose prompt: lists all entries (paginating `recall`), and for each — if it carries `references`, re-runs their `howToRead` to fetch current status — judges relevance against `staleAfter`, updating `staleAfter`/`what` or calling `forget(id)` when truly stale (the registry enforces the pre-expire hook on delete). A `howToRead` that errors is logged and the entry retained (never forget on a failed fetch). It is Claude-powered (not a pure date sweep) because "is this still relevant?" needs fetching + judgment for entity-backed entries; pure `note:` entries are judged on `staleAfter.date`/advisory text alone. The job is registered once at boot and reconciled idempotently (match by `systemActor: "memory"` + specKey, like the existing system-job pattern). It fires in `DEFAULT_REVIEW_TIMEZONE` (a module constant, default `"America/Toronto"`), overridable by an optional `config.memory.reviewTimezone`. It runs silently — no digest posted in v1. **Alternative:** a non-LLM date-only prune (rejected: misses the "re-fetch the info and decide" requirement; kept only as the `pruneExpired` fast-path helper the review can also invoke).

### D9: Worker-mode tagging is prompt-only
Every worker session already runs with `EXECUTION_SYSTEM_PROMPT` (`src/changes/execution.ts`) and has the `remember` tool available (the worktree Claude reaches the same core MCP tools, and the worker session runs as a system/owner actor so the dev+ gate passes). Tagging is a single appended instruction, roughly: *"On starting this task, call `remember` with id `worker:<branch>` (re-key to `pr:<number>` once a PR exists), `what` = a one-line description of the change, `why` = the requesting context, and `staleAfter.date` ~30 days out, so in-flight work is visible in memory."* No new worker tool, no execution-flow change. The exact `worker:`→`pr:` re-key and any later cleanup are left to Claude/the idler-consumption path; v1 only guarantees the on-start tag. **Alternative:** wire a deterministic `remember` call into `executeChange` (rejected: the user said prompt-only is fine, and a hard call would fire even for throwaway runs; the prompt lets Claude tag meaningfully).

## Risks / Trade-offs

- **Single-file blast radius** → the graceful permissive reader logs + returns empty on a parse failure, which for a *durable* bank is a worse outcome than for a cache. Mitigation: the `writeChain` serializes writes (no interleaved partial writes), and writes are whole-object `JSON.stringify`; optionally harden `persist` with temp-file + rename (the registry today does a plain `writeFile` — match it unless we choose to harden both).
- **Unbounded growth if pruning is lax** → `staleAfter` is advisory free-text for the non-date part; only the ISO date auto-prunes. Mitigation: require the date component on idler-created entries; the sync fire runs prune every cycle.
- **Migration data loss** → splitting `ideas.json` wrong could drop in-flight idler work. Mitigation: blocking migration with the source file retained (renamed, not deleted) until verified; map every `IdlerUnit` field explicitly (knowledge→core, execution→slot, reference cursors→slot).
- **Two writers (core `remember` + idler slot patch)** → both funnel through the same `writeChain`, so no lost updates; the only ordering constraint (core-first merge, D5) is enforced at the merge call.
- **Scope creep into a general KB** → keep `recall` dumb (substring/keyword) for v1; revisit embeddings only if a real need appears.

## Migration Plan

1. Ship `memoryRegistry.ts` + `sdk.memory` + `remember`/`recall` tools (additive, no behavior change yet).
2. Blocking boot migration (`/create-migration`): read the single global `data/plugins/idler/ideas.json` (the idler ledger is one SDK-scoped file, not per-repo). For each unit, write a `data/state/memory.json` entry (`id` from the unit's existing namespaced `source:key` — already globally unique, no repo-prefixing needed; `what`, `references` recipes, `staleAfter` left `{}`/estimated) + a `plugins.idler` slot (`priority`, `kind`, `open`, `whereWeAre`, and `cursorsByRefId` built from each reference's existing `cursor`). Rename `ideas.json` → `ideas.json.migrated` rather than deleting (operator-driven cleanup later).
3. Cut the idler's `sync`/`work` prompts and `tools/ideas.ts` over to `sdk.memory`.
4. **Rollback:** memory code is additive; reverting the idler prompt/tool changes and restoring `ideas.json.migrated` returns to the prior state. `data/state/memory.json` can be left in place (idler simply stops reading it).

## Open Questions

Resolved during spec review (recorded here for traceability):
- **Pre-expire hook shape** → synchronous `sdk.memory.onBeforeExpire(fn)` returning `{ vetoed, extendUntil? }`; throw = veto; any veto retains (D4).
- **Review timezone** → `DEFAULT_REVIEW_TIMEZONE` constant (default `"America/Toronto"`), overridable via optional `config.memory.reviewTimezone` (D8).
- **Review digest** → silent in v1 (D8).

Still open (non-blocking — sensible defaults chosen, revisit if needed):
- Do we harden `persist` with temp-file + rename now (and backport to `userRegistry`), or accept the convention's plain `writeFile`? (Leaning: match the convention's plain `writeFile` for v1; the serialized `writeChain` already prevents interleaving.)
- Is `data/state/memory.json` the right home, or `data/memory/` to leave room for a future per-namespace split? (Leaning: `data/state/memory.json`, matching the registry.)
