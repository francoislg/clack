## Context

The reusable worker pool (`src/workers/reusablePool.ts`) fronts a bounded set of long-lived `worker-N` folders with a per-repo FIFO queue (`src/workers/queue.ts`). When `acquire()` finds the pool saturated (`repoCount >= maxConcurrent`) it calls `queue.enqueueAndWait(...)`, returning a promise that only settles when some later event hands the waiter a worker.

Today that hand-off lives in exactly one place — `release()` (reusablePool.ts:232–237):

```ts
worker.status = "idle"; worker.claimedBy = null; this.persist();
const next = this.queue.dequeue(worker.repo);
if (next) this.fulfillQueueEntry(worker, next).catch(...);
```

But a worker returns to `idle` through three code paths, and two of them never touch the queue:

| Path | Trigger | Drains queue? |
|---|---|---|
| `release()` | PR merged / closed / discard / cancel | ✅ |
| `detachIfClean()` | idle-release sweep (monitor.ts:216) | ❌ |
| `clearQuarantine()` | admin "Discard & restore" | ❌ |

**Observed failure:** the idler auto-executed 3 changes one evening; each opened a PR and its worker was **held busy** (`pr_created`, kept for follow-ups) — pool at 3/3. A 4th change queued at position 1. Those PRs awaited human review, so they never merged (never hit `release`). ~24h later the idle-release sweep freed all three via `detachIfClean` — the workers went `idle` but the queue was never drained. The 4th waiter's `acquire` promise never resolved, hanging the auto-execute `await`, which hung the cron fire, which left the idler work cron wedged in the scheduler's in-memory `runningJobs` set. Silent, and permanent until restart.

The queue drain is purely event-driven with no backstop, so a single missed wake-up strands a waiter forever.

## Goals / Non-Goals

**Goals:**
- A queued waiter resolves whenever a worker becomes available through ANY idle-transition, not only `release()`.
- One source of truth for "a worker is free → give it to the next waiter", so future free-paths can't reintroduce the bug.
- A defensive backstop that self-heals a missed hand-off without abandoning or timing-out in-flight work.

**Non-Goals:**
- No timeout / cancellation of in-flight change execution (that would mask real deadlocks and risk killing legitimate long runs — explicitly rejected in exploration).
- No change to the disposable pool (it has no queue).
- No change to queue ordering, bounds, or the `PoolExhausted` behavior.
- Restart-time recovery of an already-orphaned in-memory queue entry / a session stuck in `executing` is a separate follow-up (`worker-session-restore`), not this change.

## Decisions

**1. Extract `pumpQueue(repo)` as the single drain step.**
Move the dequeue/fulfill block out of `release()` into a private `pumpQueue(repo: string): void` that, when a queued waiter and an idle worker both exist for the repo, selects the idle worker, dequeues one entry, **claims the worker synchronously**, and hands it to `fulfillReserved` (branch-switch + setup on the reserved worker). `release()` calls `pumpQueue(worker.repo)` after flipping the worker to idle; behavior for the release path is unchanged.

_Alternative considered — inline the drain into each free-path._ Rejected: three copies of the same logic is exactly how the bug arose. One helper is the fix.

_Alternative considered — fulfill by re-entering `acquire`._ Rejected: `acquire`'s idle path finds a worker then `await`s the branch-switch **before** claiming it, so two concurrent fulfillments can select the same idle worker and double-claim it (worktree corruption). `pumpQueue` claims synchronously up front to close that window.

**2. Call `pumpQueue` from every idle-transition.**
`detachIfClean()` and `clearQuarantine()` both end by setting a worker `idle`; each gets a `pumpQueue(worker.repo)` at that point. `pumpQueue` selects and claims a now-idle worker itself, so no special-casing of the freed worker is needed.

**3. Periodic backstop from the monitor tick.**
The change monitor (`src/changes/monitor.ts`) already runs on an interval. Add a call that, for each repo with a non-empty queue, invokes `pumpQueue(repo)`. Because `pumpQueue` only acts when an idle worker actually exists, this is a cheap no-op in the common case and a correct hand-off in the rare missed-wakeup case. Crucially it resolves the waiter by giving it a worker — it is not a timeout.

_Alternative considered — rely solely on wiring #2._ Rejected as sole measure: it's correct today but has no safety net for the next free-path someone adds. The pump is defense-in-depth; #2 is the primary fix. Keep both.

**4. `pumpQueue` must be safe to call redundantly and when idle-less.**
It reads current pool state each call: no waiters or no idle worker → return immediately. `fulfillReserved` always settles its entry (resolve, or release-the-reservation + reject on failure), so a failed hand-off rejects only that entry and does not block other waiters.

## Risks / Trade-offs

- **Concurrent idle-transitions double-claiming a worker** (a free-path and the monitor tick, or two free-paths, racing on the same repo) → `pumpQueue` claims the selected idle worker **synchronously** before the async branch-switch, so a concurrent pump sees it as busy and picks a different worker; `dequeue` removes the entry synchronously so no entry reaches two waiters. Verified by a concurrent-release test.
- **Pump does work while none is available** → guarded: it only proceeds when an idle worker for the repo exists, so the monitor backstop is a no-op when the pool is busy.
- **Fulfillment itself fails** (repo removed, branch switch throws, setup re-run fails) → `fulfillReserved` clears the reservation's claim and returns the worker to `idle` only if it is still `busy` (a mid-switch quarantine or a failed setup keep their own status), then rejects that entry as a normal change failure; other waiters and the pool are unaffected. A mid-switch `DirtyWorkerQuarantined` also fires `notifyQuarantine` (owner DM), matching `acquire` — the event is never silently dropped.
- **Does not recover an already-hung process** → out of scope by design; a restart clears it, and the follow-up covers session-restore hardening.

## Migration Plan

Pure code change, no data migration. Deploy normally. Rollback is a straight revert. To recover the currently-wedged instance, restart/redeploy (clears `runningJobs` and the dead in-memory queue entry).

## Open Questions

- ~~Should the monitor backstop emit an observability log/DM for a waiter queued far longer than expected?~~ Resolved during implementation: kept the backstop silent/minimal (the drain is cheap and correct). Revisit only if a stranded waiter is ever observed in practice.
