# worker-pool Delta

## ADDED Requirements

### Requirement: Claim Reassignment

The reusable pool SHALL support reassigning a busy worker's claim to a different sessionId without releasing the worker — no status transition, branch switch, setup, or install step. Reassignment SHALL apply only to a worker whose status is `busy`; quarantined, initializing, and failed workers are never reassigned. The pool SHALL remain agnostic of what a sessionId means — claim-liveness and permission decisions belong to the caller (the changes-workflow layer).

#### Scenario: Busy worker's claim moves to a new session

- **GIVEN** a busy worker claimed by session `S1`
- **WHEN** the caller reassigns the claim to session `S2`
- **THEN** `claimedBy` becomes `S2`, `lastUsedAt` is refreshed, and the pool state is persisted
- **AND** the worker's status, branch, and worktree are untouched

#### Scenario: Non-busy workers are not reassignable

- **GIVEN** a worker whose status is `quarantined`, `initializing`, `failed`, or `idle`
- **WHEN** a claim reassignment is attempted
- **THEN** the reassignment is rejected and the worker's record is unchanged

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
- **AND** the error carries structured readonly fields — `repo`, `branch`, and `claimedBy` (the claiming sessionId) — so callers can classify the claim without parsing the message

#### Scenario: Pool stays claim-liveness-agnostic
- **GIVEN** a busy worker holds the requested branch under another session's claim
- **WHEN** acquire is called
- **THEN** the pool rejects regardless of whether the claiming session is actively running Claude
- **AND** session adoption, orphan detection, and takeover are the caller's (changes-workflow layer's) responsibility, via the claim-reassignment and `detachIfClean` primitives

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
