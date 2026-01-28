import type { WorktreeInfo } from "../worktrees.js";
import { logger } from "../logger.js";
import type {
  ChangeRequest,
  ChangePlan,
  ChangeSession,
  ChangeStatus,
  ActiveWorker,
} from "./types.js";
import {
  createSessionFolder,
  writeSessionState,
  appendExecutionLog,
  removeSessionFolder,
  statusToPhase,
} from "./persistence.js";

// ============================================================================
// State Management
// ============================================================================

const activeSessions = new Map<string, ChangeSession>();

// Index by thread for quick lookup
const sessionsByThread = new Map<string, string>(); // threadKey -> sessionId

function getThreadKey(channel: string, threadTs: string): string {
  return `${channel}:${threadTs}`;
}

export function getActiveSession(sessionId: string): ChangeSession | undefined {
  return activeSessions.get(sessionId);
}

export function getSessionByThread(
  channel: string,
  threadTs: string
): ChangeSession | undefined {
  const sessionId = sessionsByThread.get(getThreadKey(channel, threadTs));
  return sessionId ? activeSessions.get(sessionId) : undefined;
}

export function getActiveSessionForUser(userId: string): ChangeSession | undefined {
  for (const session of activeSessions.values()) {
    if (session.userId === userId && session.status !== "completed" && session.status !== "failed") {
      return session;
    }
  }
  return undefined;
}

export function getActiveSessionCount(): number {
  let count = 0;
  for (const session of activeSessions.values()) {
    if (session.status !== "completed" && session.status !== "failed") {
      count++;
    }
  }
  return count;
}

/**
 * Get all active change sessions for display purposes
 */
export function getActiveWorkers(): ActiveWorker[] {
  const workers: ActiveWorker[] = [];

  for (const [id, session] of activeSessions.entries()) {
    // Include all sessions that are not completed/failed
    if (session.status !== "completed" && session.status !== "failed") {
      workers.push({
        id,
        userId: session.userId,
        status: session.status,
        description: session.plan.description,
        branch: session.plan.branchName,
        repo: session.plan.targetRepo,
        prUrl: session.prUrl,
        channel: session.channel,
        threadTs: session.threadTs,
        startedAt: session.createdAt,
      });
    }
  }

  // Sort by started date (newest first)
  workers.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());

  return workers;
}

export function createSession(
  request: ChangeRequest,
  plan: ChangePlan,
  worktree: WorktreeInfo,
  threadTs: string
): ChangeSession {
  const id = `change-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  const session: ChangeSession = {
    id,
    userId: request.userId,
    request,
    plan,
    worktree,
    status: "executing",
    createdAt: new Date(),
    lastActivityAt: new Date(),
    channel: request.channel,
    threadTs,
  };

  activeSessions.set(id, session);
  sessionsByThread.set(getThreadKey(request.channel, threadTs), id);

  // Create session folder for persistence and logging
  createSessionFolder(session);
  appendExecutionLog(plan.branchName, "Phase: starting");

  return session;
}

export function updateSessionStatus(sessionId: string, status: ChangeStatus, lastMessage?: string): void {
  const session = activeSessions.get(sessionId);
  if (session) {
    session.status = status;
    session.lastActivityAt = new Date();

    // Persist state and log
    const message = lastMessage ?? `Status changed to: ${status}`;
    writeSessionState(session, message);
    appendExecutionLog(session.plan.branchName, `Phase: ${statusToPhase(status)}`);
  }
}

export function updateSessionPrUrl(sessionId: string, prUrl: string): void {
  const session = activeSessions.get(sessionId);
  if (session) {
    session.prUrl = prUrl;
    session.lastActivityAt = new Date();

    // Persist state and log
    writeSessionState(session, `PR created: ${prUrl}`);
    appendExecutionLog(session.plan.branchName, `PR URL: ${prUrl}`);
  }
}

export function removeSession(sessionId: string, cleanupSessionFolder: boolean = true): void {
  const session = activeSessions.get(sessionId);
  if (session) {
    sessionsByThread.delete(getThreadKey(session.channel, session.threadTs));
    activeSessions.delete(sessionId);

    // Clean up session folder for successful completions
    if (cleanupSessionFolder && session.status === "completed") {
      removeSessionFolder(session.plan.branchName);
    }
  }
}

/**
 * Check if a change session is actively in progress (not yet completed or failed)
 */
export function isSessionInProgress(session: ChangeSession): boolean {
  const inProgressStatuses: ChangeStatus[] = ["planning", "executing", "reviewing", "merging"];
  return inProgressStatuses.includes(session.status);
}

export function cleanupExpiredSessions(expiryHours: number): void {
  const now = Date.now();
  const expiryMs = expiryHours * 60 * 60 * 1000;

  let cleaned = 0;
  let preserved = 0;

  for (const [id, session] of activeSessions.entries()) {
    const age = now - session.lastActivityAt.getTime();
    if (age > expiryMs) {
      // Never cleanup sessions that are actively in progress
      if (isSessionInProgress(session)) {
        logger.debug(`Preserving in-progress session ${id} (status: ${session.status})`);
        preserved++;
        continue;
      }
      logger.debug(`Cleaning up expired session ${id}`);
      removeSession(id);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    logger.info(`Cleaned up ${cleaned} expired change sessions`);
  }
  if (preserved > 0) {
    logger.debug(`Preserved ${preserved} in-progress change sessions`);
  }
}

/**
 * Get the active sessions map (for use by persistence cleanup)
 */
export function getActiveSessions(): Map<string, ChangeSession> {
  return activeSessions;
}
