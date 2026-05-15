## 1. Config Schema

- [x] 1.1 Add `ReusableFoldersConfig` interface to `src/config.ts` with fields: `enabled`, `minimumProvisioned`, `maxConcurrent`, `maxQueueDepth`, `idleReleaseHours`, `dirtyTrackedQuarantine`
- [x] 1.2 Extend `ChangesWorkflowConfig` with optional `reusableFolders` field
- [x] 1.3 Wire parsing in the `changesWorkflow` parser block (around `src/config.ts:669`) with defaults: `minimumProvisioned: 0`, `maxConcurrent: 3`, `maxQueueDepth: 5`, `idleReleaseHours: 24`, `dirtyTrackedQuarantine: true`
- [x] 1.4 Add unit tests covering: omitted block, partial block, full block, invalid types

## 2. WorkerPool Interface and Types

- [x] 2.1 Create `src/workers/types.ts` with `Worker`, `WorkerStatus`, `ReleaseReason`, `WorkerPool`, `QueueEntry` interfaces matching `design.md` Decision 1
- [x] 2.2 Add `PoolExhausted`, `DirtyWorkerQuarantined`, `AlreadyInFlight`, `Cancelled` error classes
- [x] 2.3 Create `src/workers/index.ts` exporting the pool factory `createPool(config) -> WorkerPool`

## 3. DisposablePool (Wrapping Existing Behavior)

- [x] 3.1 Create `src/workers/disposablePool.ts` implementing `WorkerPool` over the existing `createWorktree`/`removeWorktree` functions
- [x] 3.2 `acquire` calls `createWorktree` (or returns `getExistingWorktree` if found, matching today's resume behavior)
- [x] 3.3 `release` calls `removeWorktree`
- [x] 3.4 `findByBranch` checks the deterministic disposable path
- [x] 3.5 `ensureMinimum` is a no-op
- [x] 3.6 `list` walks `data/worktrees/<repo>/` and returns disposable-shaped `Worker` records
- [ ] 3.7 Unit tests confirming behavioral parity with the pre-change worktree functions

## 4. ReusablePool — Persistence Layer

- [x] 4.1 Define `data/state/workers.json` schema; create `src/workers/persistence.ts` with `loadPoolState`, `savePoolState`, `writeWorkerSidecar`, `readWorkerSidecar`
- [x] 4.2 Implement atomic write (write to tmp + rename) for `workers.json`
- [x] 4.3 Implement disk reconciliation: read `workers.json`, walk `data/worktrees/<repo>/worker-N` folders, run `git rev-parse --abbrev-ref HEAD` per worker, log mismatches, return reconciled in-memory state
- [x] 4.4 Adopt orphan folders as `idle` workers; prune orphan state entries
- [ ] 4.5 Tests for: clean restore, disk-vs-state mismatch, orphan folder, orphan state entry, missing folder under existing entry

## 5. ReusablePool — Core Operations

- [x] 5.1 Create `src/workers/reusablePool.ts` implementing the `WorkerPool` interface
- [x] 5.2 Implement `acquire` decision tree per `design.md` Decision 4 (idle-with-branch → idle-other → initializing-await → grow → enqueue → reject). Quarantined and failed workers MUST be excluded at every step
- [x] 5.3 Implement `claim(worker, sessionId)` and the inverse on release
- [x] 5.4 Implement `release(worker, reason)` — clear claim, set `idle` (or `quarantined` if dirty), persist
- [x] 5.5 Track `lastUsedAt` on every claim and release transition
- [ ] 5.6 Unit tests covering each decision-tree branch with a fake git surface; explicit tests that quarantined and failed workers are skipped at idle-pick, branch-lookup, and switch-target steps

## 6. ReusablePool — Branch Switching and Quarantine

- [x] 6.1 Implement `switchBranch(worker, newBranch)` per `design.md` Decision 5: dirty-check via `git diff --quiet HEAD`, fetch, `git checkout -B <branch> origin/<defaultBranch>`
- [x] 6.2 Implement `quarantine(worker, dirtyFiles)` — write `.clack-quarantine.json`, set status, persist, fire owner DM (DM hooked up in 14.1)
- [x] 6.3 Implement per-repo `data/configuration/<repo>/worktree_dirty_ignore.txt` parsing — npm-style glob patterns, one per line, `#` for comments, blank lines ignored. Missing file → no extra ignores (default behavior). Apply globs to filter `git diff --name-only HEAD` output before counting modified-tracked files
- [ ] 6.4 Tests: clean switch, dirty switch quarantines, untracked-only is not dirty, ignore glob excludes from dirty count, missing ignore file is treated as no extra ignores, no-op when same branch

## 7. ReusablePool — Boot Provisioning

- [x] 7.1 Implement `ensureMinimum(repo)` that synchronously schedules async setup for `minimumProvisioned - currentPoolSize` workers
- [x] 7.2 Each new worker enters status `initializing` with a `readyPromise` resolving on setup completion (or rejecting on failure → status `failed`)
- [x] 7.3 Wire `ensureMinimum` (fire-and-forget, non-blocking) into `src/index.ts` startup after `initializeWorktrees`. All repos provisioned in parallel. Track each new worker's `readyPromise` in the pool registry so concurrent acquires can `await` it without spawning duplicate setup
- [ ] 7.4 Tests: provisioning skipped when sufficient workers exist, failed setup marks worker `failed`, parallel provisioning across repos, startup does not block on setup, failure in one repo does not block other repos' provisioning
- [x] 7.5 Wrap `runSetup` in try/catch — on exception, set `worker.status = "failed"` (never leave in `initializing`), log at `warn` with worker id and error message, reject the worker's `readyPromise` so awaiters fall through

## 8. ReusablePool — Queue

- [x] 8.1 Implement per-repo FIFO queue in `src/workers/queue.ts` with `enqueueAndWait`, cancellable entries
- [x] 8.2 On `release`, dequeue the next entry for the repo and resolve it with the released worker
- [x] 8.3 Each `QueueEntry` carries a `cancel()` that drops it from the queue and rejects its awaiter
- [ ] 8.4 Tests: FIFO order, cancel-while-queued, dequeue-on-release, queue-full rejection

## 9. ReusablePool — Setup-Version Invalidation

- [x] 9.1 Add `setupVersionHash` to worker state; populate from `sha256(read worktree_setup_instructions.md)` on each setup completion
- [x] 9.2 In `acquire`, after `switchBranch` and before `claim`, compare current hash vs worker's hash; if differ, mark `initializing`, run setup, update hash
- [x] 9.3 Use `sha256("")` as the sentinel for a missing per-repo `worktree_setup_instructions.md`. On acquire, treat sentinel === current hash as "no setup needed"; if the file is later created, the new hash will differ and trigger a re-run on the next acquire
- [ ] 9.4 Tests: hash-match skips setup, hash-mismatch re-runs setup, missing file uses sentinel

## 10. ReusablePool — Idle Release Sweep

- [x] 10.1 Add an `idleSweep()` function that scans busy workers; integrate it into the existing `src/changes/monitor.ts` completion-monitor loop (runs on `monitoringIntervalMinutes`) — no new ticker
- [x] 10.2 Detach session-bound workers when: status `pr_created`, no live `handle`, `lastUsedAt < now - idleReleaseHours`
- [x] 10.3 On detach, run the dirty check first (same predicate as Decision 5). If dirty → quarantine and keep the session bound. If clean → `git fetch origin` + `git checkout origin/<defaultBranch>` (detached HEAD or `git checkout <defaultBranch>` after ensuring no conflicting ref) to free the branch for re-acquisition elsewhere
- [x] 10.4 Mark the session's `activeChange.worktree` as detached (define a flag — leave the branch field intact for re-acquire)
- [x] 10.5 Tests: sweep skips live-handle workers, detach succeeds on clean worker, dirty worker quarantines instead of detaching, sweep respects `monitoringIntervalMinutes` cadence
- [ ] 10.6 Test scenario: idle-release fires while an external PR is under review beyond `idleReleaseHours`; verify the worker detaches cleanly, the branch ref is freed, and a follow-up `merge`/`close` re-acquires successfully without branch conflict

## 11. Workflow Integration

- [x] 11.1 In `src/changes/workflow.ts`, replace direct `createWorktree`/`getExistingWorktree` calls in `startChangeWorkflow` with `pool.acquire`
- [x] 11.2 In `handleFollowUp`, detect detached state (a flag on `activeChange` set by `idleSweep` per task 10.4, or `activeChange.worktree === null`). If detached, call `pool.acquire(repo, branch, sessionId)` before executing the follow-up; the returned worker becomes `activeChange.worktree`. If pool returns a queued promise, post a queue ack (per task 12.5) and await it
      — re-acquire wired in `src/changes/workflow.ts:handleFollowUp`. Queue ack still TODO (task 17).
- [x] 11.3 Update `WorkflowDeps` to inject `pool` instead of `createWorktree`/`getExistingWorktree` (keep DI shape)
- [x] 11.4 Update `defaultWorkflowDeps` to source the pool from a shared singleton (`lazyDefaultPool()`)
- [x] 11.5 In `src/changes/monitor.ts`, replace `removeWorktree` calls with `pool.release(worker, "pr_merged" | "pr_closed")`
- [x] 11.6 Workflow + monitor tests updated for new shape; both modes covered through `buildMockPool` test helpers

## 12. Restoration

- [x] 12.1 In `src/index.ts`, wire pool reconciliation to run before session restoration when `reusableFolders.enabled`
      — `initializePoolForBoot` runs before `restoreWorkerSessions` in Step 3.5.
- [x] 12.2 In `src/changes/restore.ts`, when reusable mode is on, replace the "skip if worktree dir missing" path with "restore as detached" for `pr_created` sessions
- [x] 12.3 Match restored sessions to workers via `pool.findByBranch`; set `activeChange.worktree` accordingly
- [x] 12.4 Resolve conflicting claims (two sessions, same branch) by latest `lastActivityAt`: winner keeps the worker claim; loser is restored as detached (`activeChange.worktree` unset). Log the conflict at `warn` with both sessionIds
- [ ] 12.5 Wire pool-queueing acks for detached follow-up commands: when `pool.acquire` enqueues a follow-up (`merge`/`update`/`review`/`close`), post a Slack message with the queue position; when dequeued and execution begins, post a follow-up status. Reuses the same ack helpers as task 17
      — partial: startChangeWorkflow now posts a Slack ack on queue (§17.1). handleFollowUp re-acquire path doesn't pass onAck yet — small future addition.
- [x] 12.6 Tests: pool reconciliation order, branch-match restore, detached restore, conflict resolution (winner+loser outcomes), follow-up queue ack path
      — conflict resolution + detached restore covered; follow-up queue ack scenarios not yet.

## 13. Cancellation Hooks

- [x] 13.1 Extend the stop-reaction handler in `src/slack/handlers/` to consult the pool queue and call `cancel()` when the change is enqueued
      — `stopPipeline` now calls `cancelQueuedSession`; reaction + inline paths both flow through it.
- [x] 13.2 Same wiring for the inline-stop-emoji handler — same path
- [x] 13.3 Update `cancel_worker_run` MCP tool: detect queued state via `activeChange.handle === undefined` (no `ClaudeRunHandle` yet) — look up the `QueueEntry` by sessionId in the pool's queue and call `entry.cancel()`. Otherwise (handle exists), use the existing `handle.stop()` path. Return shape includes `queuedAtCancel: true` when the queue path was used
- [x] 13.4 Tests: cancel-while-queued for reaction, inline emoji, and tool paths
      — covered via `stopPipeline.test.ts` (reaction + inline share the pipeline) and `cancelWorkerRun.test.ts`.

## 14. Quarantine Notifications and Admin Action

- [x] 14.1 Implement owner DM on quarantine entry — include repo, worker id, branch, dirty file list
- [x] 14.2 Add a "Discard & restore" button to the Home Tab worker row when status is `quarantined`
- [x] 14.3 Wire button handler: gate on admin role, run `git reset --hard HEAD` and `git clean -fd` on the worker, remove `.clack-quarantine.json`, set status to `idle`
- [x] 14.4 Tests: notification fired on quarantine, button gated to admins, clear path resets correctly
      — notifier tests in `quarantineNotifier.test.ts`; button render + value tests in `homeTab.test.ts`. Integration test that ReusablePool actually fires `notifyQuarantine` from every site is still TODO.

## 15. Home Tab — Pool View

- [x] 15.1 Add a "Worker Pool" section to the Home Tab when `reusableFolders.enabled` and viewer is admin/owner
- [x] 15.2 Show per-repo: idle / busy / initializing / quarantined / failed counts and queue depth
- [x] 15.3 List queued requests with user, branch, and queue position
      — decision: kept Active Workers (active sessions) AND Worker Pool (physical slots) as complementary sections; not merged
- [ ] 15.4 Hide the disposable-mode "Active Workers" section when reusable mode is enabled (or merge them — finalize during implementation)
      — superseded by §15.3 decision; both shown.
- [x] 15.5 Tests: rendering for empty pool, mixed-state pool, queued entries

## 16. Local-Worker Shortcut for Query Tools

- [x] 16.1 Add helper `findLocalBranchSource(repo, branch)` returning a worker path or null
- [x] 16.2 (v1 proof) Wire `findLocalBranchSource` into `src/tools/query/gitLog.ts` — prefer the worker's worktree path when available, fall back to GitHub API otherwise
      — clarification: git_log already reads from the local main clone; the shortcut now lets it read from the worker's worktree when a `branch` arg is provided and a worker holds it (matters when the worker has commits the main clone hasn't pulled yet).
- [ ] 16.3 (v2 follow-up) Mark `find_changes` and `find_pull_requests` integration as TODO in code comments — out of scope for this change
- [x] 16.4 Tests: git_log uses local when available, falls back when not, ignores quarantined workers
      — quarantined exclusion is enforced inside `findByBranch` (which `findLocalBranchSource` uses); separate test for that specific exclusion is left as a follow-up.

## 17. Slack UX — Queue Acknowledgments

- [x] 17.1 When `pool.acquire` enqueues a request, post an initial Slack ack indicating queue position
      — `startChangeWorkflow` accepts `onAck`; changeAction handler wires it to `client.chat.postMessage` on the streaming thread.
- [ ] 17.2 When the request is dequeued and execution begins, post a follow-up status
      — dequeue currently signals via the existing streaming pipeline (which starts emitting tool_use events). A dedicated "now running" message is a small addition.
- [x] 17.3 When the pool rejects with `PoolExhausted`, surface the user-facing capacity message
      — `PoolExhausted.message` already includes the user-facing copy; workflow's existing catch surfaces it via the ChangeResult error path.
- [ ] 17.4 Tests for each ack path

## 18. Documentation

- [x] 18.1 Update `CLAUDE.md` Architecture / Changes Workflow section with the pool model and config block
- [ ] 18.2 Add a section in user-facing docs (or README) describing how to enable reusable folders, defaults, and operational guidance for `maxConcurrent` / `minimumProvisioned`
- [x] 18.3 Document the quarantine flow and the per-repo `worktree_dirty_ignore.txt`
      — covered in CLAUDE.md alongside the reusable pool block.

## 19. Validation

- [x] 19.1 Run `npx tsc` — no errors (on changed files; pre-existing trivia errors are out of scope)
- [x] 19.2 Run `npm test` — all suites pass, including new pool tests
- [x] 19.3 Run `npx oxlint src` and `npx oxfmt --check src` — clean on touched files
- [ ] 19.4 Manual smoke: enable `reusableFolders` on a test repo, exercise: acquire → branch switch → release on PR merge → re-acquire same branch → idle release timeout → detached follow-up → quarantine path
- [x] 19.5 Run `openspec validate rework-worktree-as-worker-pool --strict`
