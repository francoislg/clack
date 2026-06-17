# memory-faculty Specification

## Purpose

Core memory store for the system to persist facts, decisions, reminders, and entity context—shared across plugins and managed through graceful persistence with plugin-scoped namespaces.
## Requirements
### Requirement: Core memory store and record shape

The system SHALL persist a plugin-agnostic memory store at `data/state/memory.json` as a single map keyed by a stable, namespaced entry `id` (e.g. `sentry:1234`, `asana:567`, `message:<slug>`, `note:<slug>`). Memory SHALL hold *any* worth-remembering information — facts, decisions, reminders, entity context — not only tasks. Each entry SHALL carry core-owned knowledge fields — `id`, `what`, `why`, an optional `staleAfter` relevance horizon, optional `nextSteps`, a `references` array of durable read/comment recipes, an optional `linkedMemories` array of edges to other entries, and `createdAt`/`updatedAt` timestamps — plus an optional `plugins` namespace bag where each plugin owns and validates its own slice under `plugins.<pluginName>`. `staleAfter` SHALL be a structured object `{ date?: string (ISO 8601); reason?: string }`: the optional `date` is the machine-enforceable expiry and the optional `reason` is advisory free text. An entry with no `staleAfter.date` SHALL NOT be auto-pruned. Plain notes that reference no external entity SHALL be first-class entries.

`linkedMemories` SHALL be an array of edges `{ id: string; reason: string }`, where `id` is the target entry's stable key and `reason` is free-text describing the relationship. Edges SHALL be one-directional (an entry owns only its own outbound links; no reverse edge is stored or implied). The field SHALL be optional and default to an empty array under the permissive reader, so existing records load unchanged. The system SHALL NOT validate that a link target exists at write time, and SHALL tolerate a link to an `id` that is not present in the active store (a forward link or a link to a since-removed entry). `references` SHALL remain reserved for *external* surfaces and `linkedMemories` SHALL be the only field expressing memory-to-memory relationships.

#### Scenario: Entry carries core knowledge fields

- **WHEN** a memory entry is persisted
- **THEN** it has `id`, `what`, `why`, optional `staleAfter`, optional `nextSteps`, `references`, and an optional `linkedMemories` edge array
- **AND** any plugin state lives only under `plugins.<pluginName>`, never in the core fields

#### Scenario: Free-form note with no tracker entity

- **WHEN** a note is remembered with a `note:`-prefixed id and no external surface
- **THEN** it persists as a valid entry with no `plugins` namespace and no `references`

#### Scenario: Timestamps stamped on write

- **WHEN** an entry is created and later updated
- **THEN** `createdAt` is set once at creation and `updatedAt` advances on each write

#### Scenario: Entry links to another entry

- **WHEN** an entry is remembered with `linkedMemories` containing `{ id: "sentry:1234", reason: "root cause of" }`
- **THEN** the edge persists on that entry, one-directional, and no reverse edge is written on `sentry:1234`

#### Scenario: Link to an unknown id is accepted

- **GIVEN** no active entry exists for `note:future-task`
- **WHEN** an entry is remembered with a link to `note:future-task`
- **THEN** the write succeeds and the dangling edge is retained, not rejected

#### Scenario: Legacy record without links loads unchanged

- **GIVEN** an existing `memory.json` record persisted before this field existed
- **WHEN** the store is loaded
- **THEN** the record reads back with an empty `linkedMemories` array and is otherwise unchanged

### Requirement: Graceful permissive persistence with serialized writes

The memory store SHALL be loaded through a permissive zod schema as a graceful reader: on a missing file it returns the empty map, and on a parse or schema failure it logs and returns the empty map rather than throwing or silently wiping. The core schema SHALL validate only its own fields and treat `plugins` as an opaque passthrough (`z.record(z.string(), jsonObject)`). All mutations SHALL funnel through a single serialized write chain so concurrent read-modify-write from core and any plugin cannot lose updates. An in-memory cache SHALL back reads.

#### Scenario: Malformed store reads as empty

- **GIVEN** `data/state/memory.json` is missing or fails schema validation
- **WHEN** the store is loaded
- **THEN** the loader logs and returns the empty map rather than throwing or wiping the file

#### Scenario: Concurrent writes do not lose updates

- **GIVEN** core `remember` and a plugin namespace merge run concurrently
- **WHEN** both persist
- **THEN** both writes are applied (serialized through the write chain), neither overwriting the other's fields

#### Scenario: Unknown plugin slice survives a core write

- **GIVEN** an entry with a `plugins.idler` slice whose shape core does not know
- **WHEN** core updates the entry's `what`
- **THEN** the `plugins.idler` slice is preserved untouched

### Requirement: Per-plugin namespace surface with core-first merge

The system SHALL expose `sdk.memory.data(schema)` returning `{ get(id), merge(id, partial) }` auto-scoped to the calling plugin's name, where the plugin supplies its own zod schema and only its own slice is read or merged. `get` SHALL return null when the entry or the plugin's slice is absent or fails the plugin's schema. `merge` SHALL field-merge the partial into `plugins.<pluginName>` (omitted fields keep their prior value) and SHALL reject a merge for an `id` that has no core memory entry (core-first; no placeholder entries are created). The plugin surface SHALL also expose `sdk.memory.remember(input)` (create/update core fields) but SHALL NOT expose any delete operation: a plugin signals "this can go soon" by setting a short `staleAfter.date` grace window via `remember`, never by deleting. Only the core daily review deletes (after the grace passes, honoring the pre-expire hook), so an entry survives long enough to be resurrected if work resumes.

#### Scenario: Plugin merges and reads back its own slice

- **GIVEN** a core memory entry `sentry:1234` exists
- **WHEN** the idler merges `{ priority: 350 }` into its namespace and later reads it
- **THEN** the read returns the idler slice validated against the idler's schema, with `priority` 350

#### Scenario: Merge without a core entry is rejected

- **GIVEN** no memory entry exists for `sentry:9999`
- **WHEN** a plugin calls `merge("sentry:9999", …)`
- **THEN** the merge is rejected and no placeholder entry is created

#### Scenario: Plugin signals cleanup with a grace window, not a delete

- **GIVEN** a plugin has finished its work on an entry
- **WHEN** it wants the entry gone
- **THEN** it calls `remember` with a short `staleAfter.date` (a grace window) rather than deleting
- **AND** the entry persists until the daily review prunes it after that date, leaving a window to resurrect it

#### Scenario: Slice failing the plugin schema reads as null

- **GIVEN** an entry whose `plugins.idler` slice does not match the idler's schema
- **WHEN** the idler reads its slice
- **THEN** it receives null and a warning is logged, without affecting other entries

### Requirement: remember and recall query tools

The system SHALL provide a `remember` tool that creates or updates a core memory entry (keyed by namespaced `id`) and a `recall` search tool. Both SHALL be available in normal query sessions (DMs, @mentions), gated to dev+ roles, with the system cron actor permitted.

The `remember` tool SHALL accept an optional `linkedMemories` argument (an array of `{ id; reason }` edges) and SHALL pass it through to the core entry with omit-to-keep semantics (omitting the argument preserves any existing links; supplying it replaces the array), the same way the other core fields are passed through.

`recall` SHALL accept an optional keyword `query` (case-insensitive substring over the core text fields `id`, `what`, `why`, `nextSteps`, each reference's `howToRead`/`howToComment`, and each link's `reason` — not semantic/vector search), an optional `from`/`to` date range filtering on `updatedAt` (either bound optional), and pagination (`limit`, default 20; `offset`, default 0). It SHALL return `{ total, limit, offset, entries }` where `total` is the full match count and `entries` is the requested page sorted by most-recent `updatedAt`. Each returned entry SHALL be the **complete `MemoryEntry`, including its `plugins` namespace data and its `linkedMemories`** — not a projection. A query matching nothing SHALL return `{ total: 0, entries: [] }` (not an error).

For each returned entry, `recall` SHALL enrich any `linkedMemories` edge whose target `id` is not present in the active store by performing an exact-id lookup in the archive: when an archived record exists for that `id`, the returned edge SHALL gain an `archived: { summary, outcome }` field carrying the archived record's `summary`/`outcome` so the relationship surfaces "done, here's the outcome" rather than reading as a dead id; an edge whose target is present in the active store, or is neither active nor archived, SHALL be returned unchanged (no `archived` field) without erroring. This `archived` annotation SHALL be a recall-time enrichment computed per call and SHALL NOT be persisted — the stored edge is always exactly `{ id, reason }`. The enriched entry is a superset of the persisted entry (it only adds the `archived` field to edges), so it remains the complete entry and not a projection.

#### Scenario: User remembers an observation mid-session

- **GIVEN** a dev-role user in a DM
- **WHEN** they ask Clack to remember a fact with an `id`, `what`, and `why`
- **THEN** a core memory entry is created or updated

#### Scenario: Recall matches keyword and returns full entries

- **GIVEN** memory holds entries about "login crash" and "export job"
- **WHEN** `recall` is called with query "login"
- **THEN** it returns the "login crash" entry and not the unrelated one
- **AND** the returned entry includes its `plugins` namespace data and `linkedMemories`, not a projection

#### Scenario: Recall matches on a link's reason text

- **GIVEN** an entry whose only mention of "regression" is in a `linkedMemories[].reason`
- **WHEN** `recall` is called with query "regression"
- **THEN** that entry is returned, the link `reason` being part of the searchable haystack

#### Scenario: Recall resolves a link to an archived entry

- **GIVEN** an active entry links to `sentry:1234`, which has since been archived
- **WHEN** `recall` returns the active entry
- **THEN** the edge to `sentry:1234` gains an `archived: { summary, outcome }` field carrying the archived record's values
- **AND** the persisted entry is unchanged — the `archived` field exists only on the recall result

#### Scenario: Recall leaves an active or truly-unknown link unannotated

- **GIVEN** an active entry links to one `id` present in the active store and one `id` that is neither active nor archived
- **WHEN** `recall` returns the active entry
- **THEN** both edges are returned as-is, with no `archived` field, and no error is raised

#### Scenario: Recall filters by date range

- **GIVEN** entries updated on different days
- **WHEN** `recall` is called with `from`/`to` bounding a window
- **THEN** only entries whose `updatedAt` falls in the window are returned

#### Scenario: Recall paginates

- **GIVEN** more matching entries than the page `limit`
- **WHEN** `recall` is called with `limit` and `offset`
- **THEN** at most `limit` entries are returned for that page, with `total` reporting the full match count

#### Scenario: Member role cannot write memory

- **GIVEN** a member-role user
- **WHEN** they attempt to invoke `remember`
- **THEN** the tool is not available to them

### Requirement: staleAfter expiry with pre-expire veto hook

The system SHALL support pruning entries whose `staleAfter.date` has passed via record-level delete, which atomically removes the core entry and every plugin namespace slice on it. An entry with no `staleAfter.date` SHALL NOT be auto-pruned. Before deleting an entry that has any plugin namespace slice, the system SHALL consult the registered pre-expire hooks (registered via `sdk.memory.onBeforeExpire`). Each hook receives the entry and returns `{ vetoed: boolean; extendUntil?: string }`. Any hook returning `vetoed: true` SHALL retain the entry; an `extendUntil` SHALL set `staleAfter.date` to that value; a hook that throws SHALL be treated as a veto (fail-safe — state is never destroyed on a buggy hook).

#### Scenario: Stale entry is pruned whole

- **GIVEN** an entry past its `staleAfter` date with a `plugins.idler` slice and no veto
- **WHEN** the prune sweep runs
- **THEN** the entry is deleted, removing its core fields and the idler slice in one operation

#### Scenario: Plugin vetoes expiry of in-flight work

- **GIVEN** an entry past its `staleAfter.date` whose `plugins.idler` slice references an open PR
- **WHEN** the prune sweep consults the idler pre-expire hook
- **THEN** the idler returns `vetoed: true` (or an `extendUntil`), and the entry is retained

#### Scenario: Throwing hook fails safe

- **GIVEN** an entry past its `staleAfter.date` whose pre-expire hook throws
- **WHEN** the prune sweep consults it
- **THEN** the throw is treated as a veto and the entry is retained, not deleted

#### Scenario: Entry with no plugin slice prunes without a hook

- **GIVEN** a `note:` entry past its `staleAfter` date with no `plugins` namespace
- **WHEN** the prune sweep runs
- **THEN** the entry is deleted without consulting any hook

### Requirement: Daily relevance review

The system SHALL run a daily core-scheduled review (a `systemActor` cron job, channelless, firing at midnight in the configured timezone) that walks every memory entry and keeps the store relevant. For each entry that carries `references`, the review SHALL re-fetch current status via each reference's `howToRead` before judging. The review SHALL then make a three-way decision for each entry:

- **still relevant** — leave it, or call `remember` to refresh its `what` / push `staleAfter.date` out to reflect new information;
- **done and worth remembering** — distill the entry into a lean note and call `archive(id, leanNote)`, which atomically writes the lean note to the archive and removes the active entry (honoring the pre-expire hook). The review composes the lean note's `summary`/`outcome` (and optional `link`) from the re-fetched status at this moment;
- **noise, never worth remembering** — call `forget(id)` (record-level delete, honoring the pre-expire hook).

Entries with no external reference SHALL be judged on their `staleAfter` date and advisory rationale alone. After walking the active entries, the review SHALL run the mechanical archive-prune step, dropping archived records older than `archiveRetentionDays` (no fetch, no judgment).

#### Scenario: Review re-fetches referenced info before judging

- **GIVEN** an entry referencing an external issue
- **WHEN** the daily review processes it
- **THEN** it re-runs the reference's `howToRead` to fetch current status before deciding relevance

#### Scenario: Review archives a done-but-worth-remembering entry

- **GIVEN** an entry whose referenced work is resolved (e.g. its PR merged) and whose `staleAfter` has passed
- **WHEN** the daily review processes it
- **THEN** it distills a lean note and calls `archive(id, leanNote)`, removing the active entry and writing the lean record, subject to the pre-expire hook

#### Scenario: Review forgets a noise entry

- **GIVEN** an entry that is no longer relevant and not worth remembering
- **WHEN** the daily review processes it
- **THEN** it calls `forget(id)`, a true delete with no archive record written

#### Scenario: Review keeps and refreshes a still-relevant entry

- **GIVEN** an entry whose referenced info shows it still matters
- **WHEN** the daily review processes it
- **THEN** the entry is retained and its `staleAfter`/`what` may be updated to reflect the new information

#### Scenario: Note judged without fetching

- **GIVEN** a `note:` entry with no references
- **WHEN** the daily review processes it
- **THEN** relevance is judged from its `staleAfter` date and rationale, with no fetch

#### Scenario: Archive prune runs after the active walk

- **WHEN** the daily review finishes walking the active entries
- **THEN** it removes archived records older than `archiveRetentionDays` mechanically, without fetching anything

### Requirement: Worker-mode task tagging

Every Changes Workflow worker session SHALL record a memory entry for the task it starts, via an instruction in the worker system prompt (prompt-only — no dedicated worker tool). The entry SHALL be keyed to the task (e.g. `worker:<branch>`, or `pr:<number>` once a PR exists) and describe what the worker is doing, so in-flight work is visible in memory.

#### Scenario: Worker tags its task on start

- **GIVEN** a worker session begins implementing a change on a branch
- **WHEN** it starts the task
- **THEN** it remembers a memory entry keyed to the task describing the work

#### Scenario: Tagging requires no new worker tool

- **WHEN** the worker tags its task
- **THEN** it uses the existing `remember` tool reachable from the worktree session, driven by the worker system prompt

