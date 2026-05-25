## Context

**Current model.** `src/worktrees.ts` derives `worktreePath = data/worktrees/<repo>/<branch-with-/-as-->` from the requested branch name. `createWorktree` runs `git fetch --all`, deletes any pre-existing local branch, and runs `git worktree add -b <branch> <path> origin/<default>`. `runWorktreeSetup` (in `src/changes/execution.ts`) then runs the per-repo `worktree_setup_instructions.md` (typically `npm install`). When the PR closes, `monitor.ts` calls `removeWorktree` which `rm -rf`s the directory and prunes git's metadata. `cleanupStaleWorktrees` reaps anything older than `sessionExpiryHours`.

**Pain.**
- Setup cost (npm install: 30s–2min) paid on every new request.
- No upper bound on parallel worker count; nothing prevents a runaway from spawning 50 worktrees.
- Disk churn (clone-sized data created and destroyed repeatedly).
- Failed-run recovery exists (`getExistingWorktree` returns the path if it survives), but is fragile because cleanup is age-based rather than state-based.

**Constraints.**
- Must coexist with the disposable model behind a config flag — production stays on disposable until proven.
- Must not break `restore.ts` startup recovery of in-flight changes.
- Must not break the existing `monitor.ts` external-merge/external-close detection.
- Worktrees and main repos share git's object database; we cannot have two worktrees on the same branch simultaneously (git enforces this).

**Stakeholders.** Operators tuning capacity; users hitting queued-request UX; admins handling quarantines.

## Goals / Non-Goals

**Goals:**
- Eliminate redundant setup cost across requests on the same repo.
- Bound parallel worker count via `maxConcurrent`.
- Provide a reusable, well-defined `WorkerPool` API consumed by `workflow.ts`, `monitor.ts`, `restore.ts`, and the query tools that benefit from the local-worker shortcut.
- Preserve uncommitted user work (never silently discard) — quarantine + notify.
- Fast path for follow-ups when the worker still has the branch; correct (slower) path when it doesn't.

**Non-Goals:**
- Cross-host distribution. Single-process pool only.
- Snapshotting or COW filesystems. We rely on `git checkout` to swap branches.
- Replacing the disposable model. It stays as the default and is not deprecated by this change.
- Parallel runs *within* a single worker. One claim at a time.
- Persisting the pending queue across restart. Restart drops the queue.

## Decisions

### Decision 1: `WorkerPool` interface, two implementations

```ts
interface WorkerPool {
  acquire(repo: RepositoryConfig, branch: string, sessionId: string): Promise<Worker>;
  release(worker: Worker, reason: ReleaseReason): Promise<void>;
  findByBranch(repo: string, branch: string): Worker | null;   // local-worker shortcut
  list(repo?: string): Worker[];                                // Home Tab
  ensureMinimum(repo: RepositoryConfig): Promise<void>;         // boot warm-up (no-op in disposable)
}

type ReleaseReason = "pr_merged" | "pr_closed" | "idle_timeout" | "cancelled" | "failed";

interface Worker {
  id: string;                         // 'worker-1' (or '<branch-with-dashes>' in disposable)
  repo: string;
  worktreePath: string;
  currentBranch: string | null;
  status: "idle" | "busy" | "initializing" | "quarantined" | "failed";
  setupComplete: boolean;
  setupVersionHash: string | null;    // hash of worktree_setup_instructions.md when setup last ran
  claimedBy: string | null;           // sessionId when busy
  lastUsedAt: Date;
  createdAt: Date;
}
```

Two implementations:
- `DisposablePool` — wraps the existing `createWorktree`/`removeWorktree`. `acquire` always creates; `release` always removes. `findByBranch` checks the deterministic path. `ensureMinimum` is a no-op. This preserves today's behavior bit-for-bit when `reusableFolders.enabled` is false.
- `ReusablePool` — the new behavior described below.

`workflow.ts`, `monitor.ts`, etc. depend on `WorkerPool` via dependency injection (mirrors `WorkflowDeps`/`MonitorDeps` pattern already in use).

**Why a unified interface vs. branching at every callsite.** The two models diverge enough (file naming, lifecycle, queue) that conditionals scattered through `workflow.ts` would be painful to test and reason about. The interface contains the divergence to one boundary.

### Decision 2: Worker identity is the slot folder, branch is mutable state

`worker-N` is allocated incrementally per repo (`worker-1`, `worker-2`, …). The folder is permanent; the branch checked out inside is mutable state recorded in `.clack-worker-state.json` and mirrored in the in-memory pool registry.

**Alternatives considered.**
- *Hash-of-branch folder names.* Loses the "stable folder = warm node_modules" benefit. Rejected.
- *Single global pool across repos.* Each worktree is bound to one repo's git object DB by construction. Rejected.

### Decision 3: Persistence — `data/state/workers.json` + per-worker sidecar

In-memory pool registry is the source of truth at runtime. On every state transition (acquire, release, status change), write to `data/state/workers.json`. Each worker folder also has `.clack-worker-state.json` for diagnostic and recovery purposes.

On boot, restore order:
1. Read `data/state/workers.json`.
2. For each worker folder on disk, verify it still exists; reconcile by running `git rev-parse --abbrev-ref HEAD` to confirm `currentBranch`. (If state.json says one branch and disk says another, disk wins; log the discrepancy.)
3. Walk `data/worktrees/<repo>/` to detect orphan folders not in state.json — adopt them as `idle` workers if they look like reusable workers (`worker-N` naming), ignore otherwise (legacy disposable folders, will be cleaned by their own age-based reaper if applicable).
4. Then run session restore, matching `session.activeChange.branch` to a worker via `pool.findByBranch`.

**Why disk wins over state.json.** Setup commits like `npm install` create real artifacts; state.json could lie if the process crashed mid-write. Git's HEAD never lies.

### Decision 4: Acquire decision tree

```
acquire(repo, branch, sessionId):
  // 1. Already on a worker? (resume / restore-detached follow-up)
  existing = findByBranch(repo, branch)
  if existing && existing.status === 'idle':
    claim(existing, sessionId)
    return existing
  if existing && existing.status === 'busy':
    // Same branch already claimed — caller error; surface as "already in flight"
    throw AlreadyInFlight

  // 2. Idle worker for this repo?
  idle = list(repo).find(w => w.status === 'idle')
  if idle:
    await switchBranch(idle, branch)   // see Decision 5
    claim(idle, sessionId)
    return idle

  // 3. Initializing worker we can wait for?
  initializing = list(repo).find(w => w.status === 'initializing')
  if initializing:
    await initializing.readyPromise   // resolves when setup completes
    return acquire(repo, branch, sessionId)   // re-enter

  // 4. Pool size < maxConcurrent → create
  if list(repo).length < maxConcurrent:
    worker = createNewWorker(repo)   // status='initializing'
    await runSetup(worker)            // -> 'idle'
    return acquire(repo, branch, sessionId)

  // 5. Queue with bound
  if queue(repo).length < maxQueueDepth:
    return enqueueAndWait(repo, branch, sessionId)   // resolves on next release
  throw PoolExhausted
```

**Alternatives considered.**
- *Spin up worker-2 in parallel while worker-1 initializes.* Doubles cold-start cost; defeats `minimumProvisioned`. Rejected.
- *Resolve queue order LIFO.* User experience is worse — unfair to early waiters. Rejected.

### Decision 5: Branch switching with quarantine on dirty

```
switchBranch(worker, newBranch):
  if worker.currentBranch === newBranch:
    git fetch origin
    git reset --hard origin/<defaultBranch>?   // NO — would discard merged work; just skip
    return

  // Dirty check before discarding state
  if git diff --quiet HEAD fails:   // modified-tracked files exist
    quarantine(worker, listOfDirtyFiles)
    throw DirtyWorkerQuarantined    // caller falls back to acquire next worker

  // Clean — switch
  git fetch origin
  git checkout -B <newBranch> origin/<defaultBranch>
  worker.currentBranch = newBranch
```

**What counts as "dirty":** modified-tracked files only. Untracked files (build artifacts, node_modules, .env.local) are tolerated and intentional — they're the warmth we're preserving. A repo can override via `data/configuration/<repo>/worktree_dirty_ignore.txt` if a tracked file is genuinely transient.

**Quarantine clears via:** Home Tab admin action ("Discard changes & restore worker-N") or manual deletion of `.clack-quarantine.json` from the worker folder.

**Alternatives considered.**
- *Auto-stash and continue.* Stashes pile up invisibly. Users don't know to look there. Rejected.
- *`git clean -fdx` on switch.* Nukes node_modules, defeats the pool. Rejected.

### Decision 6: Idle release — session-detached, branch-by-branch

A worker holding `currentBranch` for a session in `pr_created` status with **no in-flight Claude run** can be released after `idleReleaseHours`.

```
idleSweep():
  for w in list().filter(w => w.status === 'busy' && w.lastUsedAt < now - idleReleaseHours):
    session = sessionByClaim(w.claimedBy)
    if !session.activeChange or session.activeChange.status !== 'pr_created':
      continue   // still actively working — leave alone
    if session.activeChange.handle:
      continue   // a Claude run is live — leave alone
    // Detach: clear the claim, mark idle. Folder & branch ref preserved.
    detach(w, session)
```

**Detach semantics.** The session's `activeChange.worktree` is set to `null` (or marked detached). On the next follow-up (`review`, `update`, `merge`, `close`), `handleFollowUp` calls `pool.acquire(repo, branch, sessionId)` which:
- finds the same worker if still idle on that branch (fast),
- or claims a different worker and `git checkout`s the branch (slower but correct, ~200ms),
- or queues if the pool is saturated.

**Local branch preservation.** Detach does NOT delete the local branch. `git checkout -B` on a different worker is fine — git allows the same branch ref in multiple worktrees only if not concurrently checked out, and detach guarantees the original is no longer "checked out" in the busy sense (we'll let the new acquire `git checkout` it elsewhere). The actual git invariant: a branch can be in *exactly one* worktree at a time. Switching workers requires the old one to release (via switchBranch to default, or via release).

**Wait — that's a real problem.** If worker-1 is detached but `currentBranch` still says `fix/foo`, worker-2 cannot `git checkout fix/foo`. Resolution:
- On detach, switch worker-1 back to `origin/<defaultBranch>` so the branch ref is free for adoption.
- Run the dirty check at detach time too. If dirty: quarantine instead of detaching; the session stays bound to that worker until the admin clears the quarantine.

### Decision 7: Setup-version invalidation

`worktree_setup_instructions.md` (per-repo) determines what setup runs. If it changes, existing workers have stale setup.

```
acquire path, after switchBranch, before claim:
  currentHash = sha256(read(worktree_setup_instructions.md for this repo))
  if worker.setupVersionHash !== currentHash:
    worker.status = 'initializing'
    await runSetup(worker)
    worker.setupVersionHash = currentHash
    worker.setupComplete = true
```

**Alternatives considered.**
- *Re-run setup on every acquire.* Defeats the pool. Rejected.
- *Re-run only when the file mtime changes.* Less robust (file restored from backup with old mtime evades re-setup). Hash is cheap. Adopted.

### Decision 8: Queue cancellation

The existing 🛑 cancel path goes through `activeChange.handle.stop()`. A queued request has no handle yet — it's waiting on a promise from `enqueueAndWait`. Add a cancellation hook to the queue entry:

```
interface QueueEntry {
  repo: string;
  branch: string;
  sessionId: string;
  resolve: (worker: Worker) => void;
  reject: (err: Error) => void;
  cancel: () => void;   // remove from queue, reject the awaiter
}
```

`activeChange.cancelledBy` set while queued → `cancel()` runs → `acquire()` throws `Cancelled`, `startChangeWorkflow` returns the cancelled `ChangeResult` like today. The worker is never claimed, no folder created, no impact.

### Decision 9: Local-worker shortcut for query tools

For `find_changes`, `find_pull_requests`, `git_log`, etc., when the tool needs branch state and the branch is currently in a worker, prefer reading from disk over GitHub API. New helper:

```ts
function findLocalBranchSource(repo: string, branch: string): string | null {
  const worker = pool.findByBranch(repo, branch);
  if (worker && worker.status !== "quarantined") return worker.worktreePath;
  // Fallback: main repo if it has the branch checked out (rare for query path)
  return null;   // caller falls back to GitHub API
}
```

This is a **follow-up scope**, not strictly required for the pool model. We'll wire it through one tool (`git_log` is the simplest) as proof, mark the rest as TODO.

## Risks / Trade-offs

- **[Branch ref conflict during detach]** → Detach swaps the worker back to the default branch first, freeing the ref for re-acquisition elsewhere. If dirty, we quarantine instead of detaching.
- **[Quarantine-DM noise from build artifacts]** → Default to checking only modified-tracked files (`git diff --quiet HEAD`), ignoring untracked. Per-repo override via `worktree_dirty_ignore.txt`.
- **[Setup instructions change requires invalidation]** → Hash-and-compare on acquire. Minor cost (~ms). Worker re-runs setup on next acquire if hash differs.
- **[`maxConcurrent` undersized → queue starvation]** → `maxQueueDepth` rejects beyond a bound; users get a clear error. Operators tune both.
- **[Boot provisioning races with first request]** → Acquire awaits `initializing` workers' `readyPromise`. First request blocks for up to one setup duration; not worse than the disposable model's first-request cost.
- **[Setup failure leaves zombie `initializing` worker]** → Catch in `runSetup`; mark `failed` instead of leaving in `initializing` indefinitely. `failed` is excluded from acquire and visible in Home Tab; admin can retry or remove.
- **[Pool state drift across crash]** → On boot, disk wins over `workers.json`. Orphan folders are adopted; orphan state entries are pruned. Discrepancies logged at WARN.
- **[Performance: dirty check on every release]** → `git diff --quiet HEAD` is sub-100ms even on large repos. Acceptable.
- **[Mixed-mode: switching from disposable to reusable in production]** → On first boot after enabling, `ReusablePool` ignores legacy `data/worktrees/<repo>/<branch-name>/` folders (they don't match `worker-N` naming). Disposable's age-based reaper handles them. No collision.

## Migration Plan

1. **Ship behind config flag** (`reusableFolders.enabled`, default false). All existing deployments unaffected.
2. **Internal dogfood** on a single low-traffic repo with `enabled: true, minimumProvisioned: 1, maxConcurrent: 2`.
3. **Roll forward** by setting the flag per-repo as confidence grows. (No spec changes required for per-repo override — the global flag is sufficient for v1.)
4. **No rollback migration needed.** Flipping the flag back to `false` causes new requests to use disposable; existing reusable worker folders sit idle on disk and are cleaned by the next boot's orphan-folder pruner.

## Open Questions

- **Per-repo override of pool config?** Useful if one repo wants `maxConcurrent: 5` and another `maxConcurrent: 1`. Out of scope for v1; the global value applies to all repos. Add later if needed.
- **Should `git_log` and similar query tools always prefer local worker reads, or only when GitHub API quota is tight?** Defer to follow-up. v1 wires `git_log` only as proof.
- **Quarantine clears via Home Tab — does it require admin role, or owner-of-claim role?** Lean toward admin (it's a destructive action on shared infra). Confirm with role-system review during implementation.
- **Worker count metric exposure.** Should we expose `idle/busy/queued` counts in error-reporting telemetry? Likely yes; defer to design of Home Tab block.
