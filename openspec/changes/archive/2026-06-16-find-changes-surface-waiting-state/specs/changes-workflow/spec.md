## ADDED Requirements

### Requirement: Active-Change Waiting Marker

The system SHALL record a mode-neutral "waiting for execution capacity" marker on the active-change runtime state, driven by the worker pool's existing `onQueued` acquire seam. The marker SHALL be set when an acquire enqueues and cleared when a worker is handed out, so consumers (e.g. `find_changes`) can distinguish a parked change from an actively-running one without consulting pool internals. Because the marker is driven solely by `onQueued` — which the disposable pool never fires — a model that does not enqueue acquires SHALL leave the marker unset (the abstraction degenerates rather than branching on pool model).

#### Scenario: Marker set when acquire enqueues
- **WHEN** a change request's `acquire` enqueues and the pool invokes `onQueued`
- **THEN** the system records a waiting marker on that change's active runtime state

#### Scenario: Marker cleared when worker acquired
- **WHEN** the enqueued `acquire` resolves and a worker is handed to the change
- **THEN** the system clears the waiting marker before execution proceeds

#### Scenario: Marker never set in non-enqueueing model
- **GIVEN** a worker pool that hands out a worker immediately without enqueuing (disposable pool)
- **WHEN** a change request acquires a worker
- **THEN** `onQueued` is not invoked and the waiting marker is never set

### Requirement: Active-Change Freshness Exposure

The active-change runtime snapshot consumed by query tools SHALL expose `lastActivityAt` (the timestamp of the most recent status or PR-URL update) alongside the existing `startedAt`, so freshness can be derived without changing how active changes are tracked.

#### Scenario: Snapshot includes last-activity timestamp
- **WHEN** the active-change snapshot is produced for an in-flight change
- **THEN** it includes `lastActivityAt` reflecting the most recent status/PR update
- **AND** it continues to include the existing `startedAt`
