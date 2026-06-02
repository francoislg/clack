## Why

The boot-time stale-worktree cleanup sweep (`cleanupStaleWorktrees`) is pool-model-blind: it `rm -rf`s any folder under `data/worktrees/<repo>/` whose mtime is older than `sessionExpiryHours` (default 24h), including reusable `worker-N` folders. The `ReusablePool` already owns those folders' lifecycle (idle release, quarantine) and the spec mandates they be preserved — but the sweep deletes an idle worker's folder out from under the in-memory pool, so the next change request hits a `simpleGit(<missing path>)` construction error (`Failed to create workspace: Cannot use simple-git on a directory that does not exist`) and the change silently fails. A restart only papers over it until the next 24h idle window.

## What Changes

- The boot-time stale-worktree sweep no longer deletes reusable pool folders: when `changesWorkflow.reusableFolders.enabled` is true, `cleanupStaleWorktrees` skips folders matching `worker-N`. Genuine orphan directories (e.g. leftover per-branch folders from a prior disposable-mode run) are still reaped.
- `acquire` self-heals against a missing worker folder: before reusing or branch-switching an idle worker, if its `worktreePath` no longer exists on disk, the worker is dropped from the pool and the acquire falls through to provisioning a fresh worker — instead of throwing an opaque simple-git error.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `worker-pool`: pool `worker-N` folders are exempt from the global stale-worktree cleanup sweep in reusable mode; `acquire` drops-and-reprovisions an idle worker whose folder has vanished rather than failing the change.

## Impact

- `src/worktrees.ts` — `cleanupStaleWorktrees` gains a reusable-mode guard skipping `worker-N` folders.
- `src/workers/reusablePool.ts` — `acquire` adds an on-disk existence check for the selected idle worker, with drop-and-reprovision fallback.
- No config schema changes. Disposable-mode behavior is unchanged.
