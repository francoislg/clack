## Context

`find_changes` (`src/tools/query/findChanges.ts`) projects active-change runtime state from `getActiveWorkers()` (`src/changes/activeState.ts`). It returns `id, branch, repo, description, status, prUrl, startedAt`. The `status` enum tells you the *phase* of a change but not whether it is **running** versus **parked waiting for a worker slot**.

In reusable-pool mode, `ReusablePool.acquire` (`src/workers/reusablePool.ts:208`) calls `options.onQueued(position)` when a request enqueues. The workflow already wires this (`src/changes/workflow.ts:295`) — it logs and posts a Slack queue ack — but nothing records the waiting state where `find_changes` can read it. The disposable pool never calls `onQueued`. The `WorkerPool` interface (`src/workers/types.ts:70`) is the agnostic boundary; `onQueued?` is an optional, fire-or-don't seam already in it (mirrors `refreshSetup?`).

`ActiveChangeState` already carries `lastActivityAt` (updated on every status/PR change), but `ActiveWorker` (the projection `find_changes` reads) drops it.

## Goals / Non-Goals

**Goals:**
- Let `find_changes` answer "is my change running or waiting?" and "is it progressing?".
- Stay pool-model-agnostic: the tool reads active-change state only, never the pool. Disposable mode degenerates (marker never set) with zero disposable-pool code changes.
- Reuse the existing `onQueued` seam — no new pool API.

**Non-Goals:**
- Exposing pool-internal facts (queue depth, slot ids, quarantine, setup hashes) via `find_changes`. Those stay Home-Tab/ops concerns; a separate admin pool-status tool is out of scope here.
- Surfacing the exact queue *position* in `find_changes` (a reusable-pool detail). `waiting: true` + freshness answers the human question without leaking the model.
- Any change to `worker-pool` spec or `src/workers/*`.

## Decisions

**1. Mode-neutral marker on the change, not the pool.** Add `waiting?: { since: Date }` to `ActiveChangeState`. Set it in the `onQueued` handler in `workflow.ts`; clear it immediately after `acquire` resolves (worker handed out), in the same `try` block before setup. The marker name is change-vocabulary ("waiting"), not pool-vocabulary ("queued/slot") — so the field reads correctly regardless of which pool produced it.

**2. Drive purely off `onQueued`.** No new method on `WorkerPool`. Because disposable's `acquire` never calls `onQueued`, `waiting` is never set there — the abstraction degenerates instead of branching on `pool instanceof ReusablePool`. This is the same capability-by-omission pattern the codebase already uses for `onQueued?`/`refreshSetup?`.

**3. Project derived fields in the tool.** `ActiveWorker` gains `waiting: boolean` and `lastActivityAt: Date`. `getActiveWorkers()` maps `waiting` from `change.waiting != null` and passes through `lastActivityAt`. `findChanges.ts` emits `waiting`, `lastActivityAt` (ISO), and a derived `ageMs = Date.now() - startedAt`. `ageMs` is computed in the tool (not stored) to stay fresh per call.

**4. Clearing is best-effort and idempotent.** A new `setActiveChangeWaiting(sessionId, waiting: boolean)` setter mutates the in-memory `ActiveChangeState`; it no-ops if the session is absent. It does NOT write session state to disk (waiting is ephemeral runtime state, like `handle`), avoiding extra I/O on every enqueue/dequeue.

## Risks / Trade-offs

- **Stale marker if a queued acquire is cancelled/rejected before resolving.** Mitigation: clear the marker in the workflow's existing `finally`/error path as well as the success path, so a rejected acquire (`PoolExhausted`, cancellation) does not leave `waiting: true` stuck on a dead change. Covered by a test.
- **`ageMs` measures age-since-start, not since-last-activity.** Intentional: `startedAt` is stable; `lastActivityAt` is also returned so a consumer can compute idle time if needed. Documented in the tool description.
- **`waiting` is runtime-only (not persisted).** On a process restart mid-queue the marker is lost, but so is the in-memory queue itself — consistent with how the pool already treats queued entries (non-persistent). No new inconsistency introduced.
