## 1. Exempt pool folders from the stale-worktree sweep

- [x] 1.1 In `src/worktrees.ts`, `cleanupStaleWorktrees`: when `getConfig().changesWorkflow?.reusableFolders?.enabled` is true, skip folders whose name matches `/^worker-\d+$/` in the per-folder deletion loop (leave the final `git worktree prune` pass intact)
- [x] 1.2 Add a unit test asserting a stale `worker-1` folder is NOT removed when reusable mode is enabled
- [x] 1.3 Add a unit test asserting a stale non-`worker-N` folder IS removed in reusable mode, and that all stale folders are removed when reusable mode is disabled (disposable behavior unchanged)

## 2. Self-heal acquire against a missing worker folder

- [x] 2.1 In `src/workers/reusablePool.ts`, `acquire`: before claiming the branch-already-on-worker idle path (step 1) and the generic idle path (step 2), check `existsSync(worker.worktreePath)`; if absent, remove the worker from `this.workers`, call `this.persist()`, and recurse into `acquire`
- [x] 2.2 Add a unit test: an idle worker with a missing `worktreePath` is dropped and acquire provisions a fresh worker instead of throwing
- [x] 2.3 Add a unit test: the recovered acquire returns a usable worker (no "Cannot use simple-git on a directory that does not exist" propagation)

## 3. Verify

- [x] 3.1 Run `npx tsc` (type-check), `npx oxlint` on changed files, and `npm test`
- [x] 3.2 Run `openspec validate fix-reusable-worktree-cleanup --strict`
