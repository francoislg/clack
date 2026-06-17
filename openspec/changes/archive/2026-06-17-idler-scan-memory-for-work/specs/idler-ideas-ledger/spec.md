## ADDED Requirements

### Requirement: Ignored triage marker with re-evaluation on content change

The idler work-state slice (`plugins.idler` on a core memory entry) SHALL support an optional `ignoredAt` field marking an entry the sync memory scan has triaged as not-idler-work. `ignoredAt` SHALL be a SNAPSHOT of the entry's `updatedAt` captured at ignore time (not a wall-clock timestamp). The slice schema SHALL remain permissive: an absent or legacy slice without `ignoredAt` parses unchanged. A memory entry SHALL be a scan candidate when it has NO idler slot, OR has an `ignoredAt` that DIFFERS from the entry's current `updatedAt` (the entry gained new content since it was ignored). An entry whose `ignoredAt` EQUALS its `updatedAt` SHALL be skipped, and an entry whose slice has no `ignoredAt` (a tracked work unit) SHALL NOT be a scan candidate. Marking an entry ignored SHALL be done through the existing `upsert_idea` tool (no new tool); the ignore write SHALL NOT advance the entry's `updatedAt` (it records idler's processing, not a knowledge change), so that an ignored entry remains ignored across successive scans until a genuine content write advances `updatedAt`. Ignoring SHALL be distinct from closing a unit (`open: false`): an ignored entry is not a completed work unit and SHALL NOT appear among open or done units.

#### Scenario: Ignored entry stays ignored across scans

- **GIVEN** a memory entry triaged as not-idler-work, whose slice `ignoredAt` equals its `updatedAt`
- **WHEN** successive sync memory scans run with no intervening content change
- **THEN** the entry is skipped every time (its `updatedAt` is not advanced by the ignore write, so it never re-qualifies)

#### Scenario: Re-remembered ignored entry re-qualifies

- **GIVEN** a memory entry previously stamped `ignoredAt`
- **WHEN** `remember` updates the entry's content (advancing `updatedAt` past the snapshot) and the sync memory scan runs
- **THEN** `ignoredAt` no longer equals `updatedAt`, so the entry is re-triaged as a fresh candidate

#### Scenario: Adopting an ignored entry clears the marker

- **GIVEN** a previously-ignored memory entry that a later scan deems actionable
- **WHEN** it is adopted via `upsert_idea` (with a work `kind`)
- **THEN** its `ignoredAt` is cleared and it becomes a tracked open work unit

#### Scenario: Ignored is distinct from done

- **GIVEN** a memory entry marked ignored via `upsert_idea`
- **WHEN** the work task lists open units and the digest lists done units
- **THEN** the ignored entry appears in neither (it is not an open unit and not a closed/done unit)

#### Scenario: Legacy slice without ignoredAt parses

- **GIVEN** a persisted idler slice written before this field existed
- **WHEN** it is parsed
- **THEN** parsing succeeds and the entry is treated as untriaged-eligible (no `ignoredAt` set)
