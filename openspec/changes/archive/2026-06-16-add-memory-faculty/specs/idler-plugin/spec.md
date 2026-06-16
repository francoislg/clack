## ADDED Requirements

### Requirement: Work-state in the core memory namespace

The idler SHALL persist its per-unit work-state in the core memory faculty under each entry's `plugins.idler` namespace, not in a plugin-owned `ideas.json`. During the sync fire, discovery SHALL `remember` a core memory entry for each new item (writing `what` and `references` recipes, estimating `staleAfter`) before attaching or refreshing its `plugins.idler` slice. The idler SHALL register a pre-expire hook that vetoes or extends `staleAfter` for an entry whose idler slice references an open PR, but SHALL NOT run its own prune sweep — relevance and expiry are owned by the core daily review. During the work fire, the idler SHALL select the single highest-priority entry that has a `plugins.idler` slice via `sdk.memory.data(...)`, re-read its references before acting, and write its advanced step back into the slice. When the idler CLOSES a unit (done/merged/already-done), it SHALL set `open:false` and a short `staleAfter.date` (a grace window, ~2 days) rather than deleting it — the unit survives briefly so it can be resurrected if work resumes, and the core daily review prunes it after the grace passes. The cross-entity `activity.json` digest log SHALL remain an idler-owned file.

#### Scenario: Sync writes core memory then attaches the idler slice

- **GIVEN** sync discovers a new Sentry issue
- **WHEN** it records the candidate
- **THEN** it first remembers a core memory entry (`what`, `references`, estimated `staleAfter`)
- **AND** then merges its `plugins.idler` slice (`priority`, `kind`, `whereWeAre`)

#### Scenario: Work fire selects from the memory namespace

- **GIVEN** several memory entries carry a `plugins.idler` slice
- **WHEN** the work fire picks a unit
- **THEN** it reads candidates via `sdk.memory.data(...)`, sorts by `plugins.idler.priority`, and advances the single top entry

#### Scenario: Core review respects the idler pre-expire hook

- **GIVEN** a memory entry past its `staleAfter` date whose idler slice references an open PR
- **WHEN** the core daily review attempts to forget it
- **THEN** the registered idler hook vetoes or extends `staleAfter`, and the entry is retained

#### Scenario: Activity digest stays an idler file

- **WHEN** the idler logs an action for the morning digest
- **THEN** it appends to its own `activity.json`, not to a core memory entry
