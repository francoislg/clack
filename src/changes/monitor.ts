import { getConfig } from "../config.js";
import { logger } from "../logger.js";
import { errorMessage } from "../errors.js";
import { removeWorktree } from "../worktrees.js";
import { getPRStatus, type PRState } from "./pr.js";
import { getSession } from "../sessions.js";
import type { ActiveChangeState } from "./activeState.js";
import {
  getActiveWorkers,
  updateActiveChangeStatus,
  clearActiveChange,
} from "./activeState.js";

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
export async function checkSessionCompletion(activeChange: ActiveChangeState): Promise<CompletionCheckResult> {
  // Only check changes that have PRs created
  if (activeChange.status !== "pr_created" || !activeChange.prUrl) {
    return { action: "none" };
  }

  const status = await getPRStatus(activeChange.prUrl);
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
  action: "merged" | "closed"
): Promise<void> {
  logger.info(
    `Auto-cleaning session ${sessionId} (PR ${action}): ${activeChange.prUrl}`
  );

  // Update status based on how it was completed
  const newStatus = action === "merged" ? "completed" : "failed";
  updateActiveChangeStatus(sessionId, newStatus, `PR ${action} externally`);

  // Remove the worktree
  if (activeChange.worktree) {
    try {
      await removeWorktree(activeChange.worktree.repoName, activeChange.worktree.worktreePath);
      logger.debug(`Removed worktree for session ${sessionId}`);
    } catch (error) {
      logger.warn(`Failed to remove worktree for session ${sessionId}: ${errorMessage(error)}`);
    }
  }

  // Clear the active change from the unified session
  // For merged PRs, also clean up the session folder
  // For closed PRs, preserve the session folder for debugging
  const cleanupFolder = action === "merged";
  clearActiveChange(sessionId, cleanupFolder);

  logger.info(`Session ${sessionId} cleaned up (action: ${action})`);
}

/**
 * Run a completion check for all active sessions with PRs
 */
export async function runCompletionCheck(): Promise<void> {
  const workers = getActiveWorkers();
  let checked = 0;
  let cleaned = 0;

  for (const worker of workers) {
    // Only check workers with PRs in pr_created status
    if (worker.status !== "pr_created" || !worker.prUrl) {
      continue;
    }

    checked++;

    // Get the full session to access activeChange
    const session = await getSession(worker.id);
    if (!session?.activeChange) {
      continue;
    }

    const result = await checkSessionCompletion(session.activeChange);

    if (result.action === "none") {
      continue;
    }

    // Re-fetch session to ensure it still has an active change
    const currentSession = await getSession(worker.id);
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
  const config = getConfig();
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

  // Run immediately on start, then at interval
  runCompletionCheck().catch((error) => {
    logger.error("Completion check failed:", error);
  });

  monitorInterval = setInterval(() => {
    runCompletionCheck().catch((error) => {
      logger.error("Completion check failed:", error);
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
