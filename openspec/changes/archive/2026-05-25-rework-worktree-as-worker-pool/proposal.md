## Why

Today every change request creates a fresh worktree directory, runs full setup (e.g. `npm install`), and deletes the directory when the PR closes. Setup cost is paid on every request, disk churn is constant, and there is no upper bound on parallel worker count. Reusing a small pool of long-lived worker folders keeps `node_modules` warm, makes the worst-case acquire fast, and gives operators an explicit knob (`maxConcurrent`) for capacity.

## What Changes

- Introduce a **worker pool** model where each repo has up to `maxConcurrent` long-lived worker folders (`data/worktrees/<repo>/worker-N`). Each worker carries persistent state: current branch, setup-complete flag, idle/busy/initializing/quarantined status, last-used timestamp.
- Acquire flow: pick first idle worker for the repo → checkout the requested branch → mark busy. Release flow: mark idle, **keep the folder and `node_modules`**.
- **BREAKING (opt-in):** when `changesWorkflow.reusableFolders.enabled` is `true`, the disposable per-branch worktree behavior is replaced by the pool. Default remains the disposable model — no behavior change for existing deployments.
- Boot warm-up: asynchronously provision `minimumProvisioned` workers per repo at startup. Workers in `initializing` status are joinable by acquire (it awaits the in-flight setup rather than spawning a parallel one).
- Hard cap on pool size via `maxConcurrent`. Beyond the cap, new requests are **queued FIFO per repo** and resolve when a worker is released. `maxQueueDepth` bounds the queue; beyond that, requests are rejected like today.
- Idle release: a worker holding a branch with a `pr_created` activeChange and no Claude run in flight can be released after `idleReleaseHours` (default 24). The session detaches from the worker; later follow-ups (review/update/merge) re-acquire on whatever worker is free.
- Dirty-worker quarantine: before releasing or branch-switching, if `git diff --quiet HEAD` reports modified-tracked files, mark the worker `quarantined`, persist the file list to `.clack-quarantine.json`, and DM owner(s). Quarantined workers are excluded from acquire until cleared.
- Local-worker shortcut for read-only branch lookups: query tools (`find_changes`, etc.) prefer a worker that already has the branch checked out before falling back to GitHub API.
- `monitor.ts` PR completion handler swaps `removeWorktree` for `pool.release(worker, 'pr_merged' | 'pr_closed')`.
- `restore.ts` rebuilds the worker pool from disk first, then matches active sessions to workers by `currentBranch`. Unmatched sessions are detached and re-acquire lazily.
- Setup-version invalidation: each worker records the hash of `worktree_setup_instructions.md` it was set up with. If the file changes, next acquire re-runs setup.

## Capabilities

### New Capabilities
- `worker-pool`: lifecycle and state of long-lived worker folders — acquire/release, queueing, quarantine, boot provisioning, idle-release, setup-version invalidation, persistence (`data/state/workers.json`).

### Modified Capabilities
- `changes-workflow`: configuration delta for `changesWorkflow.reusableFolders`; behavioral delta where worktree creation/cleanup is mediated by the pool when enabled.
- `worker-cancellation`: a queued-but-not-yet-claimed change must be cancellable (drop from queue without acquiring).
- `worker-session-restore`: restore order — pool state first, then session-to-worker rematch by branch; sessions whose branch is not on any worker are detached.

## Impact

- **Code:** `src/worktrees.ts` becomes the home of `WorkerPool` (or split into `src/workers/` — TBD in design). New module for queue. Modified: `src/changes/workflow.ts`, `src/changes/monitor.ts`, `src/changes/restore.ts`, `src/changes/execution.ts` (where `runWorktreeSetup` is gated by `setupComplete`), `src/config.ts` (schema), `src/tools/actions/proposeChange.ts` (resume-existing-worktree path). Query tools that may benefit from the local-worker shortcut: `src/tools/query/findChanges.ts`, `findPullRequests.ts`, `gitLog.ts`.
- **Config schema:** `changesWorkflow.reusableFolders: { enabled, minimumProvisioned, maxConcurrent, maxQueueDepth, idleReleaseHours, dirtyTrackedQuarantine }`.
- **Persistence:** new `data/state/workers.json`. Worker dirs gain `.clack-worker-state.json` and (when applicable) `.clack-quarantine.json`. Existing `data/worktrees/<repo>/<branch-with-dashes>` paths still valid in disposable mode.
- **Slack UX:** Home Tab gains a worker-pool view (idle/busy/quarantined slots, queue depth). DM channel: quarantine notifications to owner role. New ack copy when a request is queued.
- **Migration:** none required — opt-in via config. Disposable mode remains the default and unchanged.
- **Risks called out for design.md:** branch-switch dirtiness rules, queue persistence across restart (decided: not persisted), interaction between `idleReleaseHours` and an external PR being reviewed for days.
