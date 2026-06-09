## ADDED Requirements

### Requirement: Registry Entry Start Time and Snapshot

Each active-runs registry entry SHALL record the time at which the run was registered. The registry SHALL expose a `snapshot()` accessor that returns the current set of active runs without mutating state, for consumption by the runtime status endpoint. The snapshot SHALL report, per run, the lookup identity (`channel`, `thread`), the handle's lifecycle `status`, and the elapsed age in milliseconds since registration (`ageMs`). The existing `size()` accessor and all routing behavior SHALL be unchanged. No entry SHALL be evicted on the basis of age — the snapshot only observes; it does not reap.

#### Scenario: Entry records its start time

- **WHEN** a `ClaudeRunHandle` is registered for a `(channelId, threadTs)` slot
- **THEN** the entry records the registration timestamp

#### Scenario: Snapshot reports per-run age and identity

- **WHEN** `snapshot()` is called while one or more runs are registered
- **THEN** it returns one entry per active run
- **AND** each entry includes `channel`, `thread`, the handle's `status`, and an `ageMs` derived from the recorded start time
- **AND** the registry contents are not modified by the call

#### Scenario: Snapshot of an empty registry

- **WHEN** `snapshot()` is called and no runs are registered
- **THEN** it returns an empty set
- **AND** the reported active-run count is zero

#### Scenario: Snapshot does not evict stale entries

- **WHEN** a run has been registered for a long duration without settling
- **AND** `snapshot()` is called
- **THEN** the run is reported with a large `ageMs`
- **AND** the entry remains registered (the snapshot does not remove it)
