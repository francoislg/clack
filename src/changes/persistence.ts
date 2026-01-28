import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  appendFileSync,
  rmSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { getWorktreeSessionsDir } from "../config.js";
import { logger } from "../logger.js";
import type { ChangeSession, ChangeStatus, PersistedSessionState } from "./types.js";

// ============================================================================
// Session Folder Management
// ============================================================================

/**
 * Get the session folder path for a branch
 */
export function getSessionFolderPath(branchName: string): string {
  // Sanitize branch name for filesystem (replace / with -)
  const safeName = branchName.replace(/\//g, "-");
  return join(getWorktreeSessionsDir(), safeName);
}

/**
 * Ensure the worktree-sessions directory exists
 */
function ensureSessionsDir(): void {
  const dir = getWorktreeSessionsDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Create a session folder with initial state
 */
export function createSessionFolder(session: ChangeSession): void {
  ensureSessionsDir();
  const folderPath = getSessionFolderPath(session.plan.branchName);

  if (!existsSync(folderPath)) {
    mkdirSync(folderPath, { recursive: true });
  }

  // Write initial state
  writeSessionState(session, "Starting change workflow");
}

/**
 * Write session state to state.json
 */
export function writeSessionState(session: ChangeSession, lastMessage: string): void {
  const folderPath = getSessionFolderPath(session.plan.branchName);

  if (!existsSync(folderPath)) {
    mkdirSync(folderPath, { recursive: true });
  }

  const state: PersistedSessionState = {
    sessionId: session.id,
    status: session.status,
    phase: statusToPhase(session.status),
    branch: session.plan.branchName,
    repo: session.plan.targetRepo,
    userId: session.userId,
    description: session.plan.description,
    prUrl: session.prUrl ?? null,
    startedAt: session.createdAt.toISOString(),
    lastActivityAt: new Date().toISOString(),
    lastMessage: lastMessage.substring(0, 500), // Limit message length
  };

  const statePath = join(folderPath, "state.json");
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}

/**
 * Append a log entry to execution.log
 */
export function appendExecutionLog(branchName: string, message: string): void {
  const folderPath = getSessionFolderPath(branchName);

  if (!existsSync(folderPath)) {
    mkdirSync(folderPath, { recursive: true });
  }

  const logPath = join(folderPath, "execution.log");
  const timestamp = new Date().toISOString();
  const entry = `[${timestamp}] ${message}\n`;

  appendFileSync(logPath, entry);
}

/**
 * Read the current session state from disk
 */
export function readSessionState(branchName: string): PersistedSessionState | null {
  const folderPath = getSessionFolderPath(branchName);
  const statePath = join(folderPath, "state.json");

  if (!existsSync(statePath)) {
    return null;
  }

  try {
    const content = readFileSync(statePath, "utf-8");
    return JSON.parse(content) as PersistedSessionState;
  } catch {
    return null;
  }
}

/**
 * Remove session folder (for cleanup)
 */
export function removeSessionFolder(branchName: string): void {
  const folderPath = getSessionFolderPath(branchName);

  if (existsSync(folderPath)) {
    try {
      rmSync(folderPath, { recursive: true });
      logger.debug(`Removed session folder: ${folderPath}`);
    } catch (err) {
      logger.warn(`Failed to remove session folder ${folderPath}: ${err}`);
    }
  }
}

/**
 * Convert status to human-readable phase
 */
export function statusToPhase(status: ChangeStatus): string {
  switch (status) {
    case "planning":
      return "Planning";
    case "executing":
      return "Implementing";
    case "pr_created":
      return "PR Created";
    case "reviewing":
      return "Reviewing PR";
    case "merging":
      return "Merging";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    default:
      return status;
  }
}

// ============================================================================
// Resumable Session Discovery
// ============================================================================

export interface ResumableSession {
  branchName: string;
  repo: string;
  description: string;
  phase: string;
  lastMessage: string;
  startedAt: string;
}

/**
 * Get all sessions that can be resumed (have existing worktrees and state)
 */
export function getResumableSessions(): ResumableSession[] {
  const sessionsDir = getWorktreeSessionsDir();

  if (!existsSync(sessionsDir)) {
    return [];
  }

  const resumable: ResumableSession[] = [];

  try {
    const folders = readdirSync(sessionsDir);

    for (const folder of folders) {
      const folderPath = join(sessionsDir, folder);
      const statePath = join(folderPath, "state.json");

      // Skip if not a directory
      try {
        if (!statSync(folderPath).isDirectory()) continue;
      } catch {
        continue;
      }

      // Try to read state
      if (!existsSync(statePath)) continue;

      try {
        const state = JSON.parse(readFileSync(statePath, "utf-8")) as PersistedSessionState;

        // Only include sessions that are resumable (failed or in-progress, not completed)
        // pr_created sessions already have a PR and are managed differently
        const resumableStatuses: ChangeStatus[] = ["planning", "executing", "failed"];
        if (!resumableStatuses.includes(state.status)) continue;

        resumable.push({
          branchName: state.branch,
          repo: state.repo,
          description: state.description,
          phase: state.phase,
          lastMessage: state.lastMessage,
          startedAt: state.startedAt,
        });
      } catch {
        // Skip if can't parse
        continue;
      }
    }
  } catch {
    // Return empty if can't read sessions dir
  }

  return resumable;
}

// ============================================================================
// Cleanup Functions
// ============================================================================

/**
 * Clean up stale session folders.
 * - Completed sessions are cleaned up when removeSession() is called
 * - Failed sessions are NEVER automatically cleaned up (kept for debugging until manual deletion)
 * - Active sessions (in-progress) are never cleaned up
 * - Orphaned folders (no state.json, no active session) are cleaned up after retention period
 *
 * Note: activeSessions is passed as a parameter to avoid circular dependency
 */
export function cleanupStaleSessionFolders(
  retentionHours: number = 24,
  activeSessions?: Map<string, { plan: { branchName: string }; status: ChangeStatus }>
): void {
  const sessionsDir = getWorktreeSessionsDir();

  if (!existsSync(sessionsDir)) {
    return;
  }

  const now = Date.now();
  const retentionMs = retentionHours * 60 * 60 * 1000;
  let cleaned = 0;

  try {
    const folders = readdirSync(sessionsDir);

    for (const folder of folders) {
      const folderPath = join(sessionsDir, folder);
      const statePath = join(folderPath, "state.json");

      // Skip if not a directory
      try {
        if (!statSync(folderPath).isDirectory()) continue;
      } catch {
        continue;
      }

      // Try to read state
      const state = existsSync(statePath)
        ? (() => {
            try {
              return JSON.parse(readFileSync(statePath, "utf-8")) as PersistedSessionState;
            } catch {
              return null;
            }
          })()
        : null;

      // Check if there's an active in-memory session for this branch
      if (activeSessions) {
        const possibleBranch = folder.replace(/-/g, "/");
        const hasActiveSession = Array.from(activeSessions.values()).some(
          (s) => s.plan.branchName === possibleBranch || s.plan.branchName.replace(/\//g, "-") === folder
        );

        if (hasActiveSession) {
          logger.debug(`Skipping cleanup of session folder with active session: ${folder}`);
          continue;
        }
      }

      // If state exists, check status
      if (state) {
        const inProgressStatuses: ChangeStatus[] = ["planning", "executing", "reviewing", "merging"];
        if (inProgressStatuses.includes(state.status)) {
          logger.debug(`Skipping cleanup of in-progress session folder: ${folder}`);
          continue;
        }

        // Failed sessions are NEVER automatically cleaned up - kept for debugging
        if (state.status === "failed") {
          logger.debug(`Keeping failed session folder for debugging: ${folder}`);
          continue;
        }

        // pr_created sessions are kept (active PR, waiting for user action)
        if (state.status === "pr_created") {
          logger.debug(`Keeping session folder with active PR: ${folder}`);
          continue;
        }

        // Completed sessions should have been cleaned up by removeSession()
        // If they're still here, something went wrong - clean them up
        if (state.status === "completed") {
          try {
            rmSync(folderPath, { recursive: true });
            cleaned++;
            logger.debug(`Cleaned up orphaned completed session folder: ${folder}`);
          } catch (err) {
            logger.warn(`Failed to clean up session folder ${folder}: ${err}`);
          }
          continue;
        }
      }

      // For orphaned folders without state (or with unknown state), check folder age
      try {
        const folderStat = statSync(folderPath);
        const age = now - folderStat.mtimeMs;
        if (age < retentionMs) {
          continue;
        }
      } catch {
        // Continue with cleanup if we can't stat
      }

      // Clean up the orphaned folder
      try {
        rmSync(folderPath, { recursive: true });
        cleaned++;
        logger.debug(`Cleaned up stale orphaned session folder: ${folder}`);
      } catch (err) {
        logger.warn(`Failed to clean up session folder ${folder}: ${err}`);
      }
    }

    if (cleaned > 0) {
      logger.info(`Cleaned up ${cleaned} stale session folders`);
    }
  } catch (err) {
    logger.warn(`Failed to clean up session folders: ${err}`);
  }
}
