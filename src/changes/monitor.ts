import { getConfig } from "../config.js";
import { logger } from "../logger.js";
import { removeWorktree } from "../worktrees.js";
import { getSlackClient } from "../slack/app.js";
import { getPRStatus, type PRState } from "./pr.js";
import {
  getActiveSessions,
  getActiveSession,
  updateSessionStatus,
  removeSession,
} from "./session.js";
import type { ChangeSession } from "./types.js";

// ============================================================================
// Session Completion Monitoring
// ============================================================================

type CleanupAction = "merged" | "closed" | "none";

interface CompletionCheckResult {
  action: CleanupAction;
  prState?: PRState;
}

/**
 * Check if a session's PR has been completed externally
 */
export async function checkSessionCompletion(session: ChangeSession): Promise<CompletionCheckResult> {
  // Only check sessions that have PRs created
  if (session.status !== "pr_created" || !session.prUrl) {
    return { action: "none" };
  }

  const status = await getPRStatus(session.prUrl);
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
 * Clean up a session that was completed externally
 */
async function cleanupSession(
  session: ChangeSession,
  action: "merged" | "closed"
): Promise<void> {
  const sessionId = session.id;

  logger.info(
    `Auto-cleaning session ${sessionId} (PR ${action}): ${session.prUrl}`
  );

  // Update status based on how it was completed
  const newStatus = action === "merged" ? "completed" : "failed";
  updateSessionStatus(sessionId, newStatus, `PR ${action} externally`);

  // Remove the worktree
  try {
    await removeWorktree(session.worktree.repoName, session.worktree.worktreePath);
    logger.debug(`Removed worktree for session ${sessionId}`);
  } catch (error) {
    logger.warn(`Failed to remove worktree for session ${sessionId}: ${error}`);
  }

  // Remove session from memory
  // For merged PRs, also clean up the session folder
  // For closed PRs, preserve the session folder for debugging
  const cleanupFolder = action === "merged";
  removeSession(sessionId, cleanupFolder);

  logger.info(`Session ${sessionId} cleaned up (action: ${action})`);
}

/**
 * Notify user in Slack thread that their session was auto-completed
 */
async function notifySessionAutoCompleted(
  session: ChangeSession,
  reason: "merged" | "closed"
): Promise<void> {
  const client = getSlackClient();
  if (!client) {
    logger.warn("Cannot send notification: Slack client not available");
    return;
  }

  const message =
    reason === "merged"
      ? `Your PR was merged externally. Session cleaned up automatically.`
      : `Your PR was closed externally. Session cleaned up automatically.`;

  try {
    await client.chat.postMessage({
      channel: session.channel,
      thread_ts: session.threadTs,
      text: message,
    });
    logger.debug(`Sent auto-completion notification for session ${session.id}`);
  } catch (error) {
    // Log but don't throw - notification failure shouldn't block cleanup
    logger.warn(`Failed to send auto-completion notification: ${error}`);
  }
}

/**
 * Run a completion check for all active sessions with PRs
 */
export async function runCompletionCheck(): Promise<void> {
  const sessions = getActiveSessions();
  let checked = 0;
  let cleaned = 0;

  for (const [sessionId, session] of sessions.entries()) {
    // Only check sessions with PRs
    if (session.status !== "pr_created" || !session.prUrl) {
      continue;
    }

    checked++;
    const result = await checkSessionCompletion(session);

    if (result.action === "none") {
      continue;
    }

    // Re-fetch session to ensure it still exists (could have been cleaned up manually)
    const currentSession = getActiveSession(sessionId);
    if (!currentSession) {
      logger.debug(`Session ${sessionId} no longer exists, skipping cleanup`);
      continue;
    }

    // Notify before cleanup
    await notifySessionAutoCompleted(currentSession, result.action);

    // Clean up the session
    await cleanupSession(currentSession, result.action);
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
