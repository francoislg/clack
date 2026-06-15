import { getConfig } from "../config.js";
import { logger } from "../logger.js";
import { errorMessage } from "../errors.js";
import { getPRStatus, type PRState } from "./pr.js";
import { getSession } from "../sessions.js";
import type { ActiveChangeState } from "./activeState.js";
import {
  getActiveWorkers,
  updateActiveChangeStatus,
  clearActiveChange,
  detachActiveChangeWorktree,
} from "./activeState.js";
import { getPool, lazyDefaultPool } from "../workers/index.js";
import { ReusablePool } from "../workers/reusablePool.js";
import { poolWorkerForChange } from "./poolWorker.js";
import type { ReleaseReason, Worker, WorkerPool } from "../workers/types.js";

/**
 * Structural surface of `ReusablePool` used by `runIdleSweep`. Defined here so
 * tests can stub the sweep behavior without standing up a real pool. The class
 * implements this implicitly via its public methods.
 */
export interface IdleSweepPool {
  idleSweepCandidates(now?: Date): Promise<Worker[]>;
  detachIfClean(worker: Worker, options?: { treatUnpushedAsDirty?: boolean }): Promise<boolean>;
}

// ============================================================================
// Dependency Injection
// ============================================================================

export interface MonitorDeps {
  getConfig: typeof getConfig;
  pool: WorkerPool;
  /**
   * Resolve the concrete reusable pool for idle-sweep operations that the
   * abstract `WorkerPool` interface doesn't expose. Returns null when
   * reusable mode is off or the active pool is disposable. Overridable for
   * tests that need to assert sweep behavior without standing up a real pool.
   */
  getReusablePool: () => IdleSweepPool | null;
  getPRStatus: typeof getPRStatus;
  getSession: typeof getSession;
  getActiveWorkers: typeof getActiveWorkers;
  updateActiveChangeStatus: typeof updateActiveChangeStatus;
  clearActiveChange: typeof clearActiveChange;
  detachActiveChangeWorktree: typeof detachActiveChangeWorktree;
}

function defaultGetReusablePool(): IdleSweepPool | null {
  const config = getConfig();
  if (!config.changesWorkflow?.reusableFolders?.enabled) return null;
  const pool = getPool(config);
  return pool instanceof ReusablePool ? pool : null;
}

export const defaultMonitorDeps: MonitorDeps = {
  getConfig,
  pool: lazyDefaultPool(),
  getReusablePool: defaultGetReusablePool,
  getPRStatus,
  getSession,
  getActiveWorkers,
  updateActiveChangeStatus,
  clearActiveChange,
  detachActiveChangeWorktree,
};

let deps: MonitorDeps = defaultMonitorDeps;

export function setMonitorDeps(d: MonitorDeps): void {
  deps = d;
}

export function resetMonitorDeps(): void {
  deps = defaultMonitorDeps;
}

// ============================================================================
// Session Completion Monitoring
// ============================================================================

type CleanupAction = "merged" | "closed" | "none";

interface CompletionCheckResult {
  action: CleanupAction;
  prState?: PRState;
}

/**
 * Check if a session's active change PR has been completed externally
 */
export async function checkSessionCompletion(
  activeChange: ActiveChangeState,
): Promise<CompletionCheckResult> {
  // Only check changes that have PRs created
  if (activeChange.status !== "pr_created" || !activeChange.prUrl) {
    return { action: "none" };
  }

  const status = await deps.getPRStatus(activeChange.prUrl);
  if (!status) {
    // Error getting status - don't take action
    return { action: "none" };
  }

  if (status.state === "MERGED") {
    return { action: "merged", prState: status.state };
  }

  if (status.state === "CLOSED") {
    return { action: "closed", prState: status.state };
  }

  // Still open
  return { action: "none", prState: status.state };
}

/**
 * Clean up a session whose PR was completed externally
 */
async function cleanupSession(
  sessionId: string,
  activeChange: ActiveChangeState,
  action: "merged" | "closed",
): Promise<void> {
  logger.info(`Auto-cleaning session ${sessionId} (PR ${action}): ${activeChange.prUrl}`);

  // Update status based on how it was completed
  const newStatus = action === "merged" ? "completed" : "failed";
  deps.updateActiveChangeStatus(sessionId, newStatus, `PR ${action} externally`);

  // Release the worker via the pool. In disposable mode this rm -rf's the worktree;
  // in reusable mode it preserves the folder and marks the slot idle (or quarantined if dirty).
  if (activeChange.worktree) {
    const releaseReason: ReleaseReason = action === "merged" ? "pr_merged" : "pr_closed";
    const worker = poolWorkerForChange(activeChange, deps.pool);
    if (worker) {
      try {
        await deps.pool.release(worker, releaseReason);
        logger.debug(`Released worker for session ${sessionId}`);
      } catch (error) {
        logger.warn(`Failed to release worker for session ${sessionId}: ${errorMessage(error)}`);
      }
    }
  }

  // Clear the active change from the unified session
  // For merged PRs, also clean up the session folder
  // For closed PRs, preserve the session folder for debugging
  const cleanupFolder = action === "merged";
  deps.clearActiveChange(sessionId, cleanupFolder);

  logger.info(`Session ${sessionId} cleaned up (action: ${action})`);
}

/**
 * Idle-release sweep — runs alongside the completion check. Detaches workers
 * that have been holding a `pr_created` or `failed` session's branch past
 * `idleReleaseHours` with no live Claude run, so the slot can serve other branches.
 *
 * Only meaningful in reusable mode (the disposable pool's release is destructive
 * and is already triggered by PR completion, not idle time). The session keeps
 * its branch + activeChange; the next follow-up will re-acquire via the
 * detached-follow-up path in handleFollowUp.
 *
 * A live `activeChange.handle` means a Claude run is in flight — never detach.
 * A dirty worker is quarantined instead of detached, preserving the in-progress
 * work for an admin to discard or rescue.
 */
export async function runIdleSweep(): Promise<void> {
  // Idle sweep is reusable-mode-only. The deps.pool proxy doesn't expose
  // ReusablePool-specific methods (idleSweepCandidates / detachIfClean),
  // so we route through `getReusablePool` which returns null in disposable mode.
  const pool = deps.getReusablePool();
  if (!pool) return;

  const candidates = await pool.idleSweepCandidates();
  if (candidates.length === 0) return;

  let detached = 0;
  let quarantined = 0;
  let skipped = 0;

  for (const worker of candidates) {
    const sessionId = worker.claimedBy;
    if (!sessionId) {
      skipped++;
      continue;
    }

    const session = await deps.getSession(sessionId);
    const activeChange = session?.activeChange;
    if (!activeChange) {
      skipped++;
      continue;
    }

    // Only detach idle sessions: pr_created (work is on the PR) or failed
    // (recovery window expired) — others are still actively executing.
    if (activeChange.status !== "pr_created" && activeChange.status !== "failed") {
      skipped++;
      continue;
    }

    // Never detach while a Claude run is in flight, even if past the cutoff
    if (activeChange.handle) {
      skipped++;
      continue;
    }

    try {
      // A failed session may hold committed-but-unpushed work (a pr_created one
      // cannot — the PR implies a pushed branch); quarantine instead of releasing
      // so a later `checkout -B` from origin can't destroy it.
      const ok = await pool.detachIfClean(worker, {
        treatUnpushedAsDirty: activeChange.status === "failed",
      });
      if (ok) {
        deps.detachActiveChangeWorktree(sessionId);
        detached++;
        logger.info(
          `Idle-release: detached worker ${worker.id} from session ${sessionId} ` +
            `(branch ${worker.currentBranch ?? "?"} freed for re-acquire)`,
        );
      } else {
        // detachIfClean returns false when the worker was dirty and is now quarantined.
        // Keep the session bound — admin must clear the quarantine before re-acquire.
        quarantined++;
        logger.warn(
          `Idle-release: worker ${worker.id} had dirty tracked files; quarantined ` +
            `instead of detaching. Session ${sessionId} retains its claim.`,
        );
      }
    } catch (err) {
      logger.warn(`Idle-release: failed to detach worker ${worker.id}: ${errorMessage(err)}`);
      skipped++;
    }
  }

  if (detached > 0 || quarantined > 0) {
    logger.info(
      `Idle-release sweep: ${detached} detached, ${quarantined} quarantined, ${skipped} skipped`,
    );
  }
}

/**
 * Run a completion check for all active sessions with PRs
 */
export async function runCompletionCheck(): Promise<void> {
  const workers = deps.getActiveWorkers();
  let checked = 0;
  let cleaned = 0;

  for (const worker of workers) {
    // Only check workers with PRs in pr_created status
    if (worker.status !== "pr_created" || !worker.prUrl) {
      continue;
    }

    checked++;

    // Get the full session to access activeChange
    const session = await deps.getSession(worker.id);
    if (!session?.activeChange) {
      continue;
    }

    const result = await checkSessionCompletion(session.activeChange);

    if (result.action === "none") {
      continue;
    }

    // Re-fetch session to ensure it still has an active change
    const currentSession = await deps.getSession(worker.id);
    if (!currentSession?.activeChange) {
      logger.debug(`Session ${worker.id} no longer has active change, skipping cleanup`);
      continue;
    }

    // Clean up the session
    await cleanupSession(worker.id, currentSession.activeChange, result.action);
    cleaned++;
  }

  if (checked > 0) {
    logger.debug(`Completion check: ${checked} sessions checked, ${cleaned} cleaned up`);
  }
}

// ============================================================================
// Scheduler
// ============================================================================

let monitorInterval: NodeJS.Timeout | null = null;

/**
 * Start the completion monitor scheduler
 */
export function startCompletionMonitor(): void {
  const config = deps.getConfig();
  const intervalMinutes = config.changesWorkflow?.monitoringIntervalMinutes ?? 15;

  // Skip if monitoring is disabled
  if (intervalMinutes === 0) {
    logger.info("Completion monitor disabled (monitoringIntervalMinutes = 0)");
    return;
  }

  // Skip if changes workflow is disabled
  if (!config.changesWorkflow?.enabled) {
    logger.debug("Completion monitor not started (changesWorkflow disabled)");
    return;
  }

  if (monitorInterval) {
    logger.warn("Completion monitor already running");
    return;
  }

  const intervalMs = intervalMinutes * 60 * 1000;

  logger.info(`Starting completion monitor (interval: ${intervalMinutes} minutes)`);

  const scheduleCheck = async () => {
    try {
      await runCompletionCheck();
    } catch (error) {
      logger.error("Completion check failed:", error);
    }
    try {
      await runIdleSweep();
    } catch (error) {
      logger.error("Idle sweep failed:", error);
    }
  };

  // Run immediately on start, then at interval
  scheduleCheck().catch((error) => {
    logger.error("Monitor tick failed:", error);
  });
  monitorInterval = setInterval(() => {
    scheduleCheck().catch((error) => {
      logger.error("Monitor tick failed:", error);
    });
  }, intervalMs);
}

/**
 * Stop the completion monitor scheduler
 */
export function stopCompletionMonitor(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
    logger.info("Completion monitor stopped");
  }
}
