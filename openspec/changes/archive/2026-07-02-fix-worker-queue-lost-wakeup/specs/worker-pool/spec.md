## MODIFIED Requirements

### Requirement: Worker Acquire Decision Tree

The system SHALL acquire a worker for a (repo, branch, sessionId) request via a deterministic decision tree.

#### Scenario: Branch already on an idle worker
- **GIVEN** an idle worker has `currentBranch === <branch>`
- **WHEN** acquire is called
- **THEN** that worker is claimed without a branch switch
- **AND** the worker's status transitions from `idle` to `busy` with `claimedBy` set to the requesting sessionId
- **AND** the call returns the same worker reference

#### Scenario: Branch already on a busy worker
- **GIVEN** a busy worker has `currentBranch === <branch>` and a different sessionId claimed it
- **WHEN** acquire is called
- **THEN** the call rejects with an "already in flight" error

#### Scenario: Idle worker available, switch branch
- **GIVEN** at least one idle worker exists for the repo
- **AND** none has `currentBranch === <branch>`
- **WHEN** acquire is called
- **THEN** the first idle worker is selected
- **AND** its branch is switched to `<branch>` per the branch-switching requirement
- **AND** the worker is then claimed

#### Scenario: No idle, room to grow
- **GIVEN** no idle workers for the repo
- **AND** no initializing workers for the repo
- **AND** the current pool size is below `maxConcurrent`
- **WHEN** acquire is called
- **THEN** a new worker is created (`worker-<next-N>`) with status `initializing`
- **AND** setup runs to completion before the worker is claimed

#### Scenario: Pool saturated, queue available
- **GIVEN** no idle, no initializing workers for the repo
- **AND** the pool size is at `maxConcurrent`
- **AND** the queue depth is below `maxQueueDepth`
- **WHEN** acquire is called
- **THEN** the request is enqueued FIFO per repo
- **AND** the awaiter resolves when a worker for the repo next becomes available through ANY idle-transition — release, idle-release detach, or quarantine discard — not only via `release()`

#### Scenario: Pool exhausted, queue full
- **GIVEN** the pool is at `maxConcurrent` and the queue is at `maxQueueDepth`
- **WHEN** acquire is called
- **THEN** the call rejects with a `PoolExhausted` error
- **AND** the caller surfaces a user-facing message that the pool is at capacity

## ADDED Requirements

### Requirement: Queue Drain on Worker Availability

The system SHALL drain the per-repo FIFO queue whenever a worker for that repo becomes available, through a single hand-off step invoked from EVERY idle-transition, plus a periodic backstop. A queued waiter SHALL NOT remain unresolved while an idle worker for its repo exists. Draining resolves a waiter by giving it a worker; it SHALL NOT abandon, cancel, or time out any in-flight work.

#### Scenario: Release drains the queue
- **GIVEN** the pool is saturated and one or more requests are queued for a repo
- **WHEN** a worker for that repo is released (PR merged, PR closed, cancel, or discard) and becomes idle
- **THEN** the next queued waiter is dequeued FIFO and handed a now-available worker
- **AND** that waiter's `acquire` promise resolves with the claimed worker

#### Scenario: Idle-release sweep drains the queue
- **GIVEN** the pool is saturated and a request is queued for a repo
- **AND** every worker is held busy by a `pr_created` or `failed` session past the idle window
- **WHEN** the idle-release sweep detaches a held worker (making it idle)
- **THEN** the queue is drained and the queued waiter is handed the freed worker
- **AND** the waiter's `acquire` promise resolves rather than remaining pending indefinitely

#### Scenario: Quarantine discard drains the queue
- **GIVEN** a request is queued for a repo and no idle worker exists
- **WHEN** an admin discards-and-restores a quarantined worker, returning it to idle
- **THEN** the queue is drained and the queued waiter is handed the restored worker

#### Scenario: Periodic backstop resolves a missed hand-off
- **GIVEN** a request is queued for a repo and an idle worker for that repo exists
- **WHEN** the change-monitor tick runs
- **THEN** the queue is drained for that repo and the waiter is handed the idle worker
- **AND** when no idle worker exists, or no request is queued, the backstop is a no-op

#### Scenario: Concurrent idle-transitions do not double-fulfill
- **GIVEN** multiple requests are queued for a repo
- **AND** two workers for that repo become available near-simultaneously (e.g. a `release()` and an idle-release detach, or a free-path and the monitor backstop)
- **WHEN** each transition triggers a queue drain
- **THEN** each freed worker fulfills exactly one waiter, dequeued in FIFO order
- **AND** no queued entry is handed to more than one waiter, and no waiter receives more than one worker

#### Scenario: A failed hand-off does not strand other waiters
- **GIVEN** multiple requests are queued for a repo
- **WHEN** draining fulfills one entry and its acquisition fails (e.g. repo removed or branch switch throws)
- **THEN** only that entry is rejected with the failure
- **AND** the remaining queued waiters are unaffected and still eligible for the next drain
