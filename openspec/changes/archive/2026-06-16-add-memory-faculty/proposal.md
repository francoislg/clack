## Why

Clack has no general place to remember things — a useful fact, a decision, a "remind me about this later," or context about an entity. The closest thing, the idler plugin's `ideas.json` ledger, is task-specific and fuses two unrelated concerns into one record: **durable knowledge** (what something is, why it matters, where to read/comment) and **ephemeral execution bookkeeping** (priority, work-kind, cursors, progress). That fusion means knowledge only exists while the idler is enabled, nothing ever expires, and "what Clack noticed" can never be recorded outside idle-time automation. We want a first-class, plugin-agnostic **memory** faculty — Clack's own notebook for *any* worth-remembering information, not just tasks — that any session (or a user asking "remember this") can write to and search, that a daily review keeps relevant, and that the idler (and worker mode) merely *consume* and annotate.

## What Changes

- **New core `memory` faculty** — a single keyed store at `data/state/memory.json`, modeled directly on the existing `user-registry` pattern (`userRegistry.ts` + `sdk.users.data(schema)`): a per-entry record with core-owned knowledge fields plus a `plugins.<name>` namespace bag each plugin owns and validates with its own zod schema. In-memory cache, serialized `writeChain`, graceful permissive reader.
- **Memory record shape** — `id` (namespaced, e.g. `sentry:1234`, `asana:567`, `message:<slug>`, `note:<slug>`), `what`, `why`, `staleAfter` (a best-guess relevance horizon — the field today's ledger lacks), optional `nextSteps`, `references[]` (durable `howToRead`/`howToComment` recipes), and `createdAt`/`updatedAt`. Plain "useful information" notes with no external entity are first-class — memory is not task-only.
- **`remember` core tool + `recall` search tool** — write memory and search it from normal query sessions (DMs, @mentions), not just idler crons. `recall` takes keyword(s) plus an optional `from`/`to` date range, is **paginated** (`limit`/`offset`, returns total), and returns the **full entry including the `plugins` namespace data** (not a projection). Gated dev+; the system cron actor passes.
- **Daily relevance review (midnight)** — a core Claude-powered cron walks every entry: where an entry references external info, it re-fetches current status via the reference's `howToRead`, then judges whether the entry is still relevant against `staleAfter`. Expired entries are forgotten (record-level delete, honoring the pre-expire hook). This is the canonical relevance/prune pass for *all* memory.
- **Worker-mode tagging (prompt-only)** — every Changes Workflow worker session, on starting a task, records a memory entry for that task (e.g. `worker:<branch>`), so in-flight work is visible in memory. Achieved by an instruction in the worker system prompt — no new worker tool wiring.
- **`sdk.memory` plugin surface** — mirrors `sdk.users`: core `get`/`list`/`recall` plus `data(schema)` → `{ get(id), merge(id, partial) }` auto-scoped to the plugin, validating its own slot. The idler stores its work-state under `plugins.idler` instead of owning a ledger file.
- **Expiry with a pre-expire hook** — the daily review drops entries past `staleAfter` via record-level delete (which atomically drops every plugin's namespace slot with it). Before dropping, plugins with a slot may veto/extend (so an open PR isn't orphaned).
- **Idler retires `ideas.json`** — discovery/knowledge fields move to core memory entries; the idler keeps only execution bookkeeping (`priority`, `kind`, `whereWeAre`, per-reference `cursor`) in its `plugins.idler` namespace. The append-only `activity.json` log stays an idler file (cross-entity, cleared nightly — not per-entity). **BREAKING** for the idler's on-disk state; a migration splits existing units.

## Capabilities

### New Capabilities
- `memory-faculty`: Clack's core memory store — record shape, `data/state/memory.json` persistence (cache + serialized writes + graceful reader), paginated keyword + date-range `recall` search returning full entries, the daily relevance-review cron, `staleAfter` expiry with a pre-expire veto hook, worker-mode task tagging, the `remember`/`recall` query tools, and the `sdk.memory` plugin surface (core fields + per-plugin namespace bag).

### Modified Capabilities
- `idler-ideas-ledger`: the work-unit ledger is retired — the idler's per-unit state moves into the `plugins.idler` namespace on core memory entries; knowledge fields (`what`, `references` recipes) and the new `staleAfter` move to the core memory record; only execution fields (`priority`, `kind`, `whereWeAre`, reference `cursor`s) stay idler-owned.
- `idler-plugin`: the sync fire writes core memory + attaches/refreshes the idler slot; the work fire reads top units from `sdk.memory.data(...)` and writes its step back into the slot; references' read/comment recipes are read from core memory while cursors are written to the slot.

## Impact

- **New core code**: `src/memoryRegistry.ts` (clone of `userRegistry.ts`), `src/plugins/sdkMemory.ts` (clone of `sdkUsers.ts`), `remember`/`recall` tools under `src/tools/query/` (+ gating in `src/tools/server.ts`), `sdk.memory` wiring in `src/plugins/sdk.ts`.
- **Daily review cron**: a core `systemActor` cron job (via `createJob`, channelless) scheduled at midnight, with a Claude prompt that re-fetches referenced info and judges relevance/expiry.
- **Worker-mode prompt**: a tagging instruction appended to `EXECUTION_SYSTEM_PROMPT` (`src/changes/execution.ts`) — prompt-only, no new tool.
- **Idler refactor**: `ledger.ts` retired; `tools/ideas.ts`, `prompts/sync.ts`, `prompts/work.ts` rewritten to read/write memory via the SDK; the idler registers a pre-expire hook but no longer runs its own prune; `priority.ts` and `activity.ts` unchanged.
- **Migration**: a numbered boot migration (`/create-migration`) splits each existing `ideas.json` unit into a `data/state/memory.json` entry + a `plugins.idler` slot, then removes `ideas.json`.
- **New persisted file**: `data/state/memory.json`. **No new dependencies** — same file+zod+`writeChain` stack the registry already uses.
