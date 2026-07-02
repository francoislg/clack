## 1. Centralize the queue drain

- [x] 1.1 In `src/workers/reusablePool.ts`, add a private `pumpQueue(repo: string): void` that, when a queued waiter AND an idle worker both exist for the repo, selects the idle worker, dequeues one entry, claims the worker synchronously, and hands it to a new `fulfillReserved(worker, entry)` (branch-switch + setup on the reserved worker); return immediately when there is no waiter or no idle worker.
- [x] 1.2 Replace the inline dequeue/fulfill block in `release()` with a call to `pumpQueue(worker.repo)` after the worker is flipped to `idle` and persisted — preserving current release behavior.
- [x] 1.3 Claim the reserved worker synchronously in `pumpQueue` BEFORE the async branch-switch so a concurrent pump can't select the same idle worker and double-claim it; `dequeue` removes the entry synchronously so no entry reaches two waiters. `fulfillReserved` always settles the entry (resolve, or `releaseReservation` + reject on failure) so a waiter can never hang.

## 2. Wire the drain into the remaining idle-transitions

- [x] 2.1 In `detachIfClean()`, call `pumpQueue(worker.repo)` after the worker is set to `idle` (the successful-detach path only; do NOT drain on the quarantine/return-false path).
- [x] 2.2 In `clearQuarantine()`, call `pumpQueue(worker.repo)` after the worker is restored to `idle`.
- [x] 2.3 Audit any other path that returns a worker to `idle` — notably `runInitialSetup` (a newly-provisioned worker transitioning to `idle`) — and confirm it either drains via `pumpQueue` or is reliably covered by the release/monitor-backstop path; document the reasoning in a code comment. Note: `dropIfFolderMissing` does NOT set a worker `idle` — it removes the worker from the pool and the recursing `acquire` re-provisions, so it is not an idle-transition.

## 3. Periodic backstop from the monitor

- [x] 3.1 Expose a public pool method (e.g. `pumpQueuedRepos()` or reuse `listQueued`) so `src/changes/monitor.ts` can drive draining without reaching into pool internals.
- [x] 3.2 In the change-monitor tick, for each repo with a non-empty queue, invoke the drain; ensure it is a cheap no-op when no idle worker exists or the queue is empty.
- [x] 3.3 (Optional per design open question) Decided to keep the backstop minimal — no extra staleness/observability log for now; the drain itself is silent and cheap. Revisit if a stranded waiter is ever observed in practice.

## 4. Tests

- [x] 4.1 Unit test in `src/workers/reusablePool.test.ts` (pool internals only, no real git/subprocess): saturate the pool, enqueue a waiter, free a worker via `detachIfClean` → assert the waiter's `acquire` promise resolves with the freed worker.
- [x] 4.2 Unit test in `src/workers/reusablePool.test.ts`: enqueue a waiter, free a worker via `clearQuarantine` → assert the waiter resolves.
- [x] 4.3 Unit test in `src/workers/reusablePool.test.ts`: release-path drain still works (regression) and preserves FIFO order across multiple waiters.
- [x] 4.4 Unit test in `src/workers/reusablePool.test.ts`: `pumpQueue` is a no-op when no idle worker exists and when the queue is empty; a fulfillment failure rejects only that entry and leaves other waiters pending.
- [x] 4.4b Unit test in `src/workers/reusablePool.test.ts`: concurrent idle-transitions (`Promise.all([release(w1), release(w2)])`) with two waiters hand each waiter a DISTINCT worker — no double-claim (regression guard for the synchronous-reservation fix).
- [x] 4.4c Unit test in `src/workers/reusablePool.test.ts`: `pumpQueue` drops an idle worker whose folder vanished (recursion) and serves the waiter from a healthy worker; a failed fulfillment leaves the worker `idle` again.
- [x] 4.4d Unit test in `src/workers/reusablePool.test.ts`: a setup-re-run failure during fulfillment marks the reserved worker `failed` AND clears its `claimedBy` (guards the stale-claim-leak fix in `releaseReservation`).
- [x] 4.5 Monitor test in `src/changes/monitor.test.ts` (separate from the pool unit tests): verify `runQueueDrainBackstop` delegates to the pool's `pumpQueuedRepos` when reusable mode is on and is a no-op when off. Mock the pool boundary — the per-repo/idle drain semantics are the pool's own behavior, covered by the pool unit tests (4.1–4.4), not re-tested through the monitor.

## 5. Verify

- [x] 5.1 Run `npx tsc`, `npx oxlint` on changed files, `npx oxfmt --check`, and `npm test`.
- [x] 5.2 Manually trace the incident scenario against the new code path: saturate → hold all workers busy on `pr_created` → idle-sweep detach → confirm a queued waiter would now be handed a freed worker.
