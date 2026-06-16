## ADDED Requirements

### Requirement: find_changes Waiting and Freshness Reporting

The `find_changes` tool SHALL report, for each active change, whether the change is currently **waiting for execution capacity** versus actively progressing, plus a freshness signal, so Claude can answer "is my change running or parked?" and "is it making progress?". These fields SHALL be derived from active-change runtime state only and SHALL NOT reference worker-pool implementation details (queue depth, slot ids, quarantine, setup hashes). The fields SHALL be pool-model-agnostic: in a model that never enqueues acquires (disposable pool), the waiting marker is simply never set.

#### Scenario: Waiting change is flagged
- **WHEN** Claude calls `find_changes` and an active change has been enqueued by the pool and not yet handed a worker
- **THEN** the change's result entry includes `waiting: true`

#### Scenario: Running change is not flagged as waiting
- **WHEN** Claude calls `find_changes` and an active change has been handed a worker (or runs in a model that does not enqueue)
- **THEN** the change's result entry reports `waiting` as `false` (or omits it)

#### Scenario: Freshness fields reported
- **WHEN** Claude calls `find_changes`
- **THEN** each change entry includes `lastActivityAt` (ISO timestamp of the most recent status/PR update) and a derived `ageMs` (elapsed time since `startedAt`)

#### Scenario: No pool-internal fields leak
- **WHEN** Claude calls `find_changes`
- **THEN** the result entries do NOT include queue depth, queue position, worker/slot identifiers, quarantine state, or setup-version data
