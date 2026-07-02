## Why

A queued change-workflow acquire can be orphaned forever. The reusable worker pool only drains its FIFO queue inside `release()`, but a worker also returns to `idle` through the idle-release sweep (`detachIfClean`) and the admin quarantine-discard (`clearQuarantine`) — neither of which drains the queue. When every worker is freed by one of those paths while a request is queued, the awaiting `acquire` promise never resolves. In production this hung an idler auto-executed change indefinitely, which in turn hung the cron fire that awaited it and left the idler's work cron wedged (it did no work for two nights). The queue must be drained whenever a worker becomes available, not only on `release()`.

## What Changes

- Centralize queue-draining into a single `pumpQueue(repo)` step that hands the next queued waiter an available idle worker, and invoke it from **every** path that returns a worker to `idle`: `release`, `detachIfClean` (idle-release sweep), and `clearQuarantine` (admin discard).
- Add a periodic defensive pump: the change monitor tick calls `pumpQueue` for any repo that has queued waiters and an available worker, so a missed hand-off self-heals within one tick instead of stranding the waiter forever. This resolves the waiter properly (gives it a worker) — it never abandons or times out in-flight work.
- Behavior is unchanged when the queue is empty or the pool is not saturated; the disposable pool (no queue) is unaffected.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `worker-pool`: the queued awaiter SHALL resolve when a worker becomes available through ANY idle-transition (release, idle-release detach, quarantine discard), not only via `release()`; and the pool SHALL drain the queue on every worker-availability transition plus a periodic backstop.

## Impact

- `src/workers/reusablePool.ts` — extract the dequeue/fulfill block from `release()` into `pumpQueue`; call it from `detachIfClean` and `clearQuarantine`.
- `src/changes/monitor.ts` — invoke `pumpQueue` from the periodic monitor tick as the backstop.
- No config, schema, or data-format changes. No new dependencies.
- Operational note (out of scope for code): a running instance already wedged by this bug is recovered by a process restart, which clears the in-memory `runningJobs` set and abandons the dead in-memory queue entry.
