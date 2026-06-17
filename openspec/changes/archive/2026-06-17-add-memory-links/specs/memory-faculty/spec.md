## MODIFIED Requirements

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
