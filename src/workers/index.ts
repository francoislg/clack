import { getConfig, type Config, type RepositoryConfig } from "../config.js";
import { logger } from "../logger.js";
import { errorMessage } from "../errors.js";
import type { Worker, WorkerPool } from "./types.js";
import { DisposablePool } from "./disposablePool.js";
import { ReusablePool, type SetupRunner } from "./reusablePool.js";

export type { Worker, WorkerStatus, WorkerPool, QueueEntry, ReleaseReason } from "./types.js";
export { workerToWorktreeInfo } from "./types.js";
export { PoolExhausted, DirtyWorkerQuarantined, AlreadyInFlight, Cancelled } from "./errors.js";

let cachedPool: WorkerPool | null = null;

/**
 * Build the worker pool for the given config. Returns `ReusablePool` when
 * `changesWorkflow.reusableFolders.enabled` is true, `DisposablePool` otherwise.
 */
export function createPool(config: Config): WorkerPool {
  const reusable = config.changesWorkflow?.reusableFolders;
  if (reusable?.enabled) {
    return new ReusablePool(reusable);
  }
  return new DisposablePool();
}

/**
 * Singleton accessor for the workflow layer. First call constructs from current config.
 * Tests can override via `setPool` / `resetPool`.
 */
export function getPool(config: Config): WorkerPool {
  if (!cachedPool) {
    cachedPool = createPool(config);
  }
  return cachedPool;
}

/**
 * Lazy proxy that defers pool construction to the first method call.
 * Lets `defaultWorkflowDeps`/`defaultMonitorDeps` be exported at module-load time
 * without requiring `loadConfig()` to have already run.
 */
export function lazyDefaultPool(): WorkerPool {
  return {
    acquire: (...args) => getPool(getConfig()).acquire(...args),
    release: (...args) => getPool(getConfig()).release(...args),
    findByBranch: (...args) => getPool(getConfig()).findByBranch(...args),
    list: (...args) => getPool(getConfig()).list(...args),
    ensureMinimum: (...args) => getPool(getConfig()).ensureMinimum(...args),
  };
}

export function setPool(pool: WorkerPool): void {
  cachedPool = pool;
}

export function resetPool(): void {
  cachedPool = null;
}

/**
 * Boot-time initialization for reusable mode. Idempotent and safe to call when
 * `reusableFolders.enabled` is false — returns without touching the pool.
 *
 * Steps when enabled:
 * 1. Injects `setupRunner` so the pool can re-run setup on new workers and on
 *    setup-instruction-hash mismatches without depending on the workflow layer.
 * 2. Reconciles in-memory state with disk so `findByBranch` and `list` are
 *    accurate before session restore reads them.
 */
export async function initializePoolForBoot(
  config: Config,
  setupRunner: SetupRunner,
): Promise<void> {
  if (!config.changesWorkflow?.reusableFolders?.enabled) return;
  const pool = getPool(config);
  if (!(pool instanceof ReusablePool)) return;
  pool.setSetupRunner(setupRunner);
  await pool.reconcile();
}

/**
 * Fire-and-forget warm-up: provision `minimumProvisioned` workers per repo.
 * Each `ensureMinimum` call is awaited internally by the pool but kicked off
 * in parallel here so slow repos do not block boot.
 */
export function provisionMinimumWorkers(config: Config, repos: RepositoryConfig[]): void {
  if (!config.changesWorkflow?.reusableFolders?.enabled) return;
  const pool = getPool(config);
  if (!(pool instanceof ReusablePool)) return;
  for (const repo of repos) {
    pool.ensureMinimum(repo).catch((err) => {
      logger.warn(`ensureMinimum failed for ${repo.name}: ${errorMessage(err)}`);
    });
  }
}

/**
 * Find a queued acquire entry by sessionId and cancel it. Used by stop-reaction,
 * inline-stop, and `cancel_worker_run` paths to abort a request that hasn't yet
 * been given a worker (i.e., there's no `ClaudeRunHandle` to `.stop()`).
 *
 * Returns true when a queued entry was found and cancelled; false otherwise
 * (no queue entry, or disposable mode where there is no queue).
 */
export function cancelQueuedSession(sessionId: string, reason?: string): boolean {
  if (!cachedPool || !(cachedPool instanceof ReusablePool)) return false;
  const entry = cachedPool.findQueuedBySession(sessionId);
  if (!entry) return false;
  entry.cancel(reason);
  return true;
}

/**
 * Find the on-disk path of a worker that currently has `branch` checked out
 * for `repo`. Used by query tools (`git_log`, etc.) as a fast path — reading
 * from the worker is correct and skips a GitHub API round-trip when the branch
 * is already local to a worker. Returns null when:
 * - reusable mode is off (disposable folders don't have a stable branch index)
 * - no worker has the branch
 * - the only matching worker is quarantined or failed (those are excluded)
 */
export function findLocalBranchSource(repo: string, branch: string): string | null {
  if (!cachedPool || !(cachedPool instanceof ReusablePool)) return null;
  const worker = cachedPool.findByBranch(repo, branch);
  // findByBranch already excludes quarantined + failed workers — no further filter needed.
  return worker?.worktreePath ?? null;
}

export type ClearQuarantineResult = { ok: true; worker: Worker } | { ok: false; reason: string };

export interface WorkerPoolSnapshot {
  /** Whether the active pool is the reusable implementation. */
  reusable: boolean;
  /** Aggregate counts by repo. Always populated, even when reusable=false. */
  byRepo: WorkerPoolRepoSnapshot[];
}

export interface WorkerSnapshotEntry {
  id: string;
  status: "idle" | "busy" | "initializing" | "quarantined" | "failed";
  currentBranch: string | null;
  /** sessionId of the busy claimant, when applicable. */
  claimedBy: string | null;
  setupComplete: boolean;
  /** sha256 of `worktree_setup_instructions.md` when setup last ran. */
  setupVersionHash: string | null;
  lastUsedAt: Date;
  createdAt: Date;
}

export interface WorkerPoolRepoSnapshot {
  repo: string;
  idle: number;
  busy: number;
  initializing: number;
  quarantined: number;
  failed: number;
  queueDepth: number;
  /** Full per-worker view for the unified Home Tab "Workers" section. */
  workers: WorkerSnapshotEntry[];
  /** Queued entries — surfaced so the Home Tab can show who's waiting. */
  queued: Array<{
    sessionId: string;
    branch: string;
    enqueuedAt: Date;
  }>;
}

/**
 * Snapshot the pool for the Home Tab. In disposable mode the snapshot still
 * works (empty per-repo entries) so the caller can branch on `reusable` without
 * special-casing.
 */
export function getWorkerPoolSnapshot(): WorkerPoolSnapshot {
  if (!cachedPool || !(cachedPool instanceof ReusablePool)) {
    return { reusable: false, byRepo: [] };
  }
  const workers = cachedPool.list();
  const reposByName = new Map<string, WorkerPoolRepoSnapshot>();
  const ensureRepo = (repo: string): WorkerPoolRepoSnapshot => {
    let entry = reposByName.get(repo);
    if (!entry) {
      entry = {
        repo,
        idle: 0,
        busy: 0,
        initializing: 0,
        quarantined: 0,
        failed: 0,
        queueDepth: 0,
        workers: [],
        queued: [],
      };
      reposByName.set(repo, entry);
    }
    return entry;
  };
  for (const w of workers) {
    const entry = ensureRepo(w.repo);
    entry[w.status]++;
    entry.workers.push({
      id: w.id,
      status: w.status,
      currentBranch: w.currentBranch,
      claimedBy: w.claimedBy,
      setupComplete: w.setupComplete,
      setupVersionHash: w.setupVersionHash,
      lastUsedAt: w.lastUsedAt,
      createdAt: w.createdAt,
    });
  }
  // Sort workers by id for a stable display order
  for (const entry of reposByName.values()) {
    entry.workers.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  }
  // Add queue depth and queued entries per repo (repos with no workers but
  // pending queue entries are surfaced too)
  const allQueued = cachedPool.listQueued();
  for (const q of allQueued) {
    const entry = ensureRepo(q.repo);
    entry.queueDepth++;
    entry.queued.push({
      sessionId: q.sessionId,
      branch: q.branch,
      enqueuedAt: q.enqueuedAt,
    });
  }
  return {
    reusable: true,
    byRepo: Array.from(reposByName.values()).sort((a, b) => a.repo.localeCompare(b.repo)),
  };
}

/**
 * Discard local changes on a quarantined worker and restore it to the idle pool.
 * Runs `git reset --hard HEAD` and `git clean -fd` in the worker dir, removes
 * the quarantine sidecar, and flips the worker's status from `quarantined` to
 * `idle` so it can be acquired again.
 *
 * Returns `{ ok: false, reason }` when reusable mode is off, the worker id is
 * unknown, the worker is not quarantined, or the git operations fail. Caller
 * is expected to gate by admin role.
 */
export async function clearQuarantinedWorker(
  workerId: string,
  repo: string,
): Promise<ClearQuarantineResult> {
  if (!cachedPool || !(cachedPool instanceof ReusablePool)) {
    return { ok: false, reason: "Reusable worker pool is not active" };
  }
  return cachedPool.clearQuarantine(workerId, repo);
}
