## ADDED Requirements

### Requirement: Cancel Queued Change

The system SHALL support cancelling a change request that is enqueued in the worker pool but has not yet been claimed.

#### Scenario: Cancel via 🛑 reaction while queued
- **GIVEN** a change request is awaiting a worker in the pool's per-repo queue
- **WHEN** the user reacts with the configured stop emoji on the originating message
- **THEN** the queue entry's `cancel()` is invoked
- **AND** the awaiter rejects with a `Cancelled` error
- **AND** `startChangeWorkflow` returns `{ success: false, cancelled: true, cancelledBy: { userId, reason: "stopped via reaction" } }`
- **AND** no worker is claimed and no folder is created

#### Scenario: Cancel via inline stop emoji while queued
- **GIVEN** a change request is awaiting a worker in the pool's queue
- **WHEN** a message matching the inline stop-emoji rule arrives in the same thread
- **THEN** the queue entry is cancelled with reason "stopped via inline emoji"
- **AND** the workflow returns a cancelled result without claiming any worker

#### Scenario: cancel_worker_run rejects on queued entries with appropriate message
- **GIVEN** a change is enqueued with no `ClaudeRunHandle` yet
- **WHEN** `cancel_worker_run` is called for the requesting user
- **THEN** the tool resolves the queue entry's `cancel()` rather than calling `handle.stop`
- **AND** returns `{ ok: true, cancelled: true, sessionId, description, queuedAtCancel: true }`

#### Scenario: Already-claimed change unaffected by queue cancel
- **GIVEN** a change request has been dequeued and a worker is now executing
- **WHEN** the queue's cancel path is invoked (e.g., race between dequeue and reaction)
- **THEN** the queue entry is already gone and the cancel is a no-op on the queue side
- **AND** the existing in-flight cancellation path (`handle.stop`) is used instead
