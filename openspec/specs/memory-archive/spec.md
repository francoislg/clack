# memory-archive Specification

## Purpose

Terminal archive store for completed memory entries with lean record shape and retention-based pruning. Complements the active memory faculty by preserving terminal outcomes for point-lookup without exposing completed items to general recall.

## Requirements

### Requirement: Lean archive store and record shape

The system SHALL persist a terminal memory archive at `data/state/memory-archive.json` as a single map keyed by the same stable, namespaced `id` used by the active memory store (e.g. `sentry:1234`, `pr:123`). An archived record SHALL be a LEAN, terminal note — it carries `id`, `summary` (one line: what the entry was about), `outcome` (what happened, e.g. "Fixed in PR #123, merged 2026-06-10" or "Abandoned: dupe of sentry:99"), an optional `link` (a bare URL to the resolving artifact), and `archivedAt` (ISO 8601). An archived record SHALL NOT carry the active store's live-work machinery: no reference `howToRead`/`howToComment` recipes and no `plugins` namespace bag. The archive SHALL be loaded through a permissive zod schema as a graceful reader — on a missing file it returns the empty map, and on a parse or schema failure it logs and returns the empty map rather than throwing or wiping. All mutations SHALL funnel through a serialized write chain and an in-memory cache SHALL back reads, mirroring the active store.

#### Scenario: Archived record carries only lean terminal fields

- **WHEN** a record is written to the archive
- **THEN** it has `id`, `summary`, `outcome`, optional `link`, and `archivedAt`
- **AND** it carries no reference recipes and no `plugins` namespace

#### Scenario: Malformed archive reads as empty

- **GIVEN** `data/state/memory-archive.json` is missing or fails schema validation
- **WHEN** the archive is loaded
- **THEN** the loader logs and returns the empty map rather than throwing or wiping the file

### Requirement: Exact-ID-only retrieval

The archive SHALL be retrievable ONLY by exact stable `id` via `getArchived(id)`, returning the lean record or null, exposed to sessions as a `get_archived` tool (gated to dev+ with the system cron actor permitted). The archive SHALL NOT be exposed to the keyword `recall` search and SHALL NOT support substring, date-range, or paginated listing for consumers — its sole purpose is a point lookup by a caller that already holds the stable key, so completed items never re-pollute the active recall surface.

#### Scenario: Point lookup by stable id returns the lean record

- **GIVEN** an archived record for `sentry:1234`
- **WHEN** a caller calls `getArchived("sentry:1234")`
- **THEN** it receives the lean record with its `summary`, `outcome`, and `archivedAt`

#### Scenario: Missing id returns null

- **GIVEN** no archived record for `sentry:9999`
- **WHEN** a caller calls `getArchived("sentry:9999")`
- **THEN** it receives null, not an error

#### Scenario: Archive is invisible to keyword recall

- **GIVEN** an archived record whose `summary` contains "login crash"
- **WHEN** `recall` is invoked with query "login"
- **THEN** the archived record is not among the results — recall searches the active store only

### Requirement: Atomic distill-and-remove archive tool

The system SHALL provide an `archive(id, leanNote)` operation, available in normal query sessions gated to dev+ roles with the system cron actor permitted, that atomically writes the lean note to the archive AND removes the entry from the active memory store in one operation, so the entry is never present in both stores or neither. Because removal destroys active state, `archive` SHALL consult the registered pre-expire hooks the same way `forget` does: any hook returning `vetoed: true` (or throwing, treated as a veto) SHALL retain the active entry and SHALL NOT write the archive record — state is never destroyed against a plugin's veto. When no veto applies, the active entry (its core fields and every `plugins` slice) SHALL be removed and the lean record written.

#### Scenario: Archive writes the lean note and removes the active entry

- **GIVEN** an active entry `sentry:1234` with no veto
- **WHEN** `archive("sentry:1234", { summary, outcome })` is called
- **THEN** the lean record is written to the archive
- **AND** the active entry (including any `plugins` slice) is removed from the active store

#### Scenario: Vetoed archive retains the active entry and writes nothing

- **GIVEN** an active entry whose `plugins.idler` slice references an open PR
- **WHEN** `archive` is attempted and the idler pre-expire hook vetoes
- **THEN** the active entry is retained and no archive record is written

### Requirement: Age-horizon archive pruning

The system SHALL prune archived records whose `archivedAt` is older than a configurable `archiveRetentionDays` horizon (default 365). Pruning SHALL be mechanical — no external fetch and no Claude involvement — comparing `archivedAt` against the horizon. The prune SHALL be exposed as a `prune_archive` tool (gated to dev+ with the system cron actor permitted) that the daily review invokes as a step.

#### Scenario: Record past the retention horizon is pruned

- **GIVEN** an archived record whose `archivedAt` is older than `archiveRetentionDays`
- **WHEN** the archive prune step runs
- **THEN** the record is removed from the archive without any fetch

#### Scenario: Record within the horizon is kept

- **GIVEN** an archived record whose `archivedAt` is within `archiveRetentionDays`
- **WHEN** the archive prune step runs
- **THEN** the record is retained
