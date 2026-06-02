## Context

Two boot-time actors disagree about the lifecycle of reusable `worker-N` folders:

1. `initializePoolForBoot` → `reconcilePoolState` (`src/index.ts:221`) runs early, walks `data/worktrees/<repo>/`, and populates the in-memory pool with the idle `worker-N` entries present at that moment.
2. `cleanupWorktrees` (`src/index.ts:271`, fired after "Clack is ready"), gated only by `changesWorkflow.enabled`, calls `cleanupStaleWorktrees` (`src/worktrees.ts:209`). That function walks **every** folder under `data/worktrees/<repo>/` and `rm -rf`s (`removeWorktree`) any whose directory mtime exceeds `sessionExpiryHours` (default 24h) — with no awareness of the reusable pool.

The result: reconcile registers `worker-1` as idle, the cleanup sweep deletes its folder, and the in-memory pool keeps pointing at the now-missing path. The next change request enters `ReusablePool.acquire` step 2, calls `switchBranch` → `getDirtyTrackedFiles` → `getGitInstance(<missing path>)`, and simple-git throws at construction time (`index.js:4636`): *"Cannot use simple-git on a directory that does not exist"*. The change fails with `Failed to create workspace: …`. A restart only fixes it transiently — reconcile prunes the dead entry and `provisionMinimumWorkers` re-creates a worker, which ages out again after 24h idle.

The `worker-pool` spec already states pool folders are preserved across acquire/release (Worker Identity and Folder Layout → "Folder is preserved on release"). The stale sweep violates that invariant from outside the pool.

## Goals / Non-Goals

**Goals:**
- Stop the global stale-worktree sweep from deleting reusable `worker-N` folders.
- Make `acquire` resilient: a selected idle worker whose folder has vanished must not surface an opaque simple-git error — it should self-heal.
- Leave disposable-mode cleanup behavior exactly as-is.

**Non-Goals:**
- Removing the stale-worktree sweep entirely (it still has a job in disposable mode and for reaping genuine orphan dirs).
- Changing the reusable pool's own idle-release / quarantine timing (`idleReleaseHours`).
- Any config schema change.

## Decisions

**Decision 1: Skip `worker-N` folders in `cleanupStaleWorktrees` under reusable mode (not gate the whole sweep off).**
When `changesWorkflow.reusableFolders.enabled` is true, the per-folder loop in `cleanupStaleWorktrees` skips folders matching `/^worker-\d+$/`. Everything else (per-branch folders left over from a disposable→reusable switch, stray dirs) is still subject to the mtime sweep, and the `git worktree prune` pass at the end is unchanged.

- *Alternative considered: remove the `cleanupWorktrees` call / gate the entire sweep off in reusable mode.* Simpler, but it would also stop reaping legitimate orphan directories, and is a blunter change than the symptom requires. Rejected in favor of the surgical skip. (This was the user's "just remove the cron" instinct — narrowed to "the sweep stops touching pool folders" so orphan cleanup survives.)
- *Why mtime is the wrong signal for pool folders:* a `worker-N` folder's top-level mtime is not reliably bumped by git operations in subdirectories, so even an actively-used worker can appear "stale" — making deletion both incorrect and hard to predict.

**Decision 2: `acquire` checks `existsSync(worker.worktreePath)` before reusing/branch-switching an idle worker; drop-and-reprovision on miss.**
At `ReusablePool.acquire` (`src/workers/reusablePool.ts`), when an idle worker is selected (the branch-already-on-worker path and the generic idle path), if its folder is absent on disk, remove the worker from `this.workers`, `persist()`, and recurse into `acquire` so the normal decision tree creates a fresh worker. This converts any external folder disappearance into a transparent re-provision rather than a hard failure.

- *Alternative considered: catch the simple-git construction error inside `switchBranch` and translate it.* More fragile (string/Error-type matching on a library error) and reactive; the explicit `existsSync` guard is cheaper and clearer, mirroring the existing `DirtyWorkerQuarantined` fall-through pattern already in `acquire`.

Decision 1 prevents the root cause; Decision 2 is defense-in-depth so the pool self-heals if a folder ever vanishes for any other reason.

## Risks / Trade-offs

- **A truly orphaned `worker-N` folder (no live pool entry, e.g. left by a crash) is never reaped by the stale sweep in reusable mode** → It is instead adopted as idle by `reconcilePoolState` on the next boot (existing behavior), so it re-enters the managed pool rather than leaking. Acceptable.
- **`existsSync` adds a stat per idle-worker acquire** → Negligible; acquire already performs multiple git/filesystem operations.
- **Recursion in `acquire` after dropping a worker** → Bounded the same way the existing dirty-quarantine fall-through is bounded: each pass removes the offending worker from `this.workers`, so the set strictly shrinks before falling through to create/grow.
