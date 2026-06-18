## MODIFIED Requirements

### Requirement: remember and recall query tools

The system SHALL provide a `remember` tool that creates or updates a core memory entry (keyed by namespaced `id`) and a `recall` search tool. Both SHALL be available in normal query sessions (DMs, @mentions) to all roles (member and above), with the system cron actor permitted.

The `remember` tool SHALL accept an optional `linkedMemories` argument (an array of `{ id; reason }` edges) and SHALL pass it through to the core entry with omit-to-keep semantics (omitting the argument preserves any existing links; supplying it replaces the array), the same way the other core fields are passed through.

`recall` SHALL accept an optional keyword `query` (case-insensitive substring over the core text fields `id`, `what`, `why`, `nextSteps`, each reference's `howToRead`/`howToComment`, and each link's `reason` — not semantic/vector search), an optional `from`/`to` date range filtering on `updatedAt` (either bound optional), and pagination (`limit`, default 20; `offset`, default 0). It SHALL return `{ total, limit, offset, entries }` where `total` is the full match count and `entries` is the requested page sorted by most-recent `updatedAt`. Each returned entry SHALL be the **complete `MemoryEntry`, including its `plugins` namespace data and its `linkedMemories`** — not a projection. A query matching nothing SHALL return `{ total: 0, entries: [] }` (not an error).

For each returned entry, `recall` SHALL enrich any `linkedMemories` edge whose target `id` is not present in the active store by performing an exact-id lookup in the archive: when an archived record exists for that `id`, the returned edge SHALL gain an `archived: { summary, outcome }` field carrying the archived record's `summary`/`outcome` so the relationship surfaces "done, here's the outcome" rather than reading as a dead id; an edge whose target is present in the active store, or is neither active nor archived, SHALL be returned unchanged (no `archived` field) without erroring. This `archived` annotation SHALL be a recall-time enrichment computed per call and SHALL NOT be persisted — the stored edge is always exactly `{ id, reason }`. The enriched entry is a superset of the persisted entry (it only adds the `archived` field to edges), so it remains the complete entry and not a projection.

#### Scenario: User remembers an observation mid-session

- **GIVEN** a member-role user in a DM
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

#### Scenario: Member role can use memory tools

- **GIVEN** a member-role user
- **WHEN** they invoke `remember` or `recall`
- **THEN** the tools are available to them, the memory faculty being open to all roles

#### Scenario: System cron actor can use memory tools

- **GIVEN** the internal `system` cron actor (the daily review or a plugin cron)
- **WHEN** it invokes a memory tool
- **THEN** the tool is available, the system actor passing the role gate
