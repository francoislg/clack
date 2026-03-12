import {
  existsSync,
  writeFileSync,
  mkdirSync,
  appendFileSync,
  rmSync,
} from "node:fs";
import { readFile, readdir, stat, rm } from "node:fs/promises";
import { join } from "node:path";
import { getWorktreeSessionsDir } from "../config.js";
import { logger } from "../logger.js";
import type { ChangeSession, ChangeStatus, PersistedSessionState, WriteableSessionState } from "./types.js";

// ============================================================================
// Session Folder Management
// ============================================================================

export function getSessionFolderPath(branchName: string): string {
  // Sanitize branch name for filesystem (replace / with -)
  const safeName = branchName.replace(/\//g, "-");
  return join(getWorktreeSessionsDir(), safeName);
}

function ensureSessionsDir(): void {
  const dir = getWorktreeSessionsDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function createSessionFolder(session: ChangeSession): void {
  ensureSessionsDir();
  const folderPath = getSessionFolderPath(session.plan.branchName);

  if (!existsSync(folderPath)) {
    mkdirSync(folderPath, { recursive: true });
  }

  // Write initial state
  writeSessionState(session, "Starting change workflow");
}

export function writeSessionState(session: WriteableSessionState, lastMessage: string): void {
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
    channel: session.channel,
    threadTs: session.threadTs,
  };

  const statePath = join(folderPath, "state.json");
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}

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

function isValidSessionState(parsed: unknown): parsed is PersistedSessionState {
  return typeof parsed === "object" && parsed !== null && "sessionId" in parsed && "branch" in parsed && "status" in parsed;
}

function parseSessionState(content: string): PersistedSessionState | null {
  const parsed: unknown = JSON.parse(content);
  return isValidSessionState(parsed) ? parsed : null;
}

export async function readSessionState(branchName: string): Promise<PersistedSessionState | null> {
  const folderPath = getSessionFolderPath(branchName);
  const statePath = join(folderPath, "state.json");

  try {
    const content = await readFile(statePath, "utf-8");
    const parsed: unknown = JSON.parse(content);
    if (!isValidSessionState(parsed)) {
      logger.warn(`Corrupt session state file ${statePath}: missing required fields`);
      return null;
    }
    return parsed;
  } catch (err) {
    logger.debug(`Could not read session state for branch "${branchName}": ${err}`);
    return null;
  }
}

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
// Session Scanner
// ============================================================================

/**
 * Get all persisted session states from disk (no status filtering).
 * Returns every parseable state.json found in worktree-sessions/.
 */
export async function getAllPersistedSessions(): Promise<PersistedSessionState[]> {
  const sessionsDir = getWorktreeSessionsDir();

  if (!existsSync(sessionsDir)) {
    return [];
  }

  const sessions: PersistedSessionState[] = [];

  try {
    const folders = await readdir(sessionsDir);

    for (const folder of folders) {
      const folderPath = join(sessionsDir, folder);
      const statePath = join(folderPath, "state.json");

      try {
        if (!(await stat(folderPath)).isDirectory()) continue;
      } catch (err) {
        logger.debug(`Could not stat session folder "${folder}": ${err}`);
        continue;
      }

      try {
        const content = await readFile(statePath, "utf-8");
        const state = parseSessionState(content);
        if (state) sessions.push(state);
      } catch (err) {
        logger.debug(`Could not read session state in "${folder}": ${err}`);
        continue;
      }
    }
  } catch (err) {
    logger.debug(`Could not read worktree sessions directory: ${err}`);
  }

  return sessions;
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
export async function getResumableSessions(): Promise<ResumableSession[]> {
  const sessionsDir = getWorktreeSessionsDir();

  if (!existsSync(sessionsDir)) {
    return [];
  }

  const resumable: ResumableSession[] = [];

  try {
    const folders = await readdir(sessionsDir);

    for (const folder of folders) {
      const folderPath = join(sessionsDir, folder);
      const statePath = join(folderPath, "state.json");

      // Skip if not a directory
      try {
        if (!(await stat(folderPath)).isDirectory()) continue;
      } catch (err) {
        logger.debug(`Could not stat session folder "${folder}": ${err}`);
        continue;
      }

      try {
        const content = await readFile(statePath, "utf-8");
        const state = parseSessionState(content);
        if (!state) continue;

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
      } catch (err) {
        logger.debug(`Could not parse session state in "${folder}": ${err}`);
        continue;
      }
    }
  } catch (err) {
    logger.debug(`Could not read worktree sessions directory: ${err}`);
  }

  return resumable;
}

// ============================================================================
// Cleanup Functions
// ============================================================================

/** Outcome of evaluating whether a session folder should be cleaned up. */
type CleanupDecision =
  | { action: "skip"; reason: string }
  | { action: "cleanup"; label: string }
  | { action: "check_age"; label: string };

/**
 * Determine whether a session folder should be cleaned up based on its state
 * and whether it has an active in-memory branch.
 */
function shouldCleanupSession(
  state: PersistedSessionState | null,
  folder: string,
  activeBranches?: Set<string>
): CleanupDecision {
  // Check if there's an active in-memory change for this branch
  if (activeBranches) {
    const possibleBranch = folder.replace(/-/g, "/");
    if (activeBranches.has(possibleBranch) || activeBranches.has(folder)) {
      return { action: "skip", reason: `active branch: ${folder}` };
    }
  }

  // No state file (or unparseable) — treat as orphan, subject to age check
  if (!state) {
    return { action: "check_age", label: "stale orphaned" };
  }

  switch (state.status) {
    // In-progress work — never clean up
    case "planning":
    case "executing":
    case "reviewing":
    case "merging":
      return { action: "skip", reason: `in-progress session: ${folder}` };

    // Failed sessions kept for debugging — never auto-cleaned
    case "failed":
      return { action: "skip", reason: `failed session (kept for debugging): ${folder}` };

    // PR waiting for user action — keep
    case "pr_created":
      return { action: "skip", reason: `active PR: ${folder}` };

    // Completed sessions should have been removed by removeSession() already
    case "completed":
      return { action: "cleanup", label: "orphaned completed" };

    // Unknown status — treat as orphan, subject to age check
    default:
      return { action: "check_age", label: "unknown-status orphaned" };
  }
}

async function tryRemoveFolder(folderPath: string, folder: string, label: string): Promise<boolean> {
  try {
    await rm(folderPath, { recursive: true });
    logger.debug(`Cleaned up ${label} session folder: ${folder}`);
    return true;
  } catch (err) {
    logger.warn(`Failed to clean up session folder ${folder}: ${err}`);
    return false;
  }
}

async function tryReadState(statePath: string): Promise<PersistedSessionState | null> {
  try {
    const content = await readFile(statePath, "utf-8");
    return parseSessionState(content);
  } catch (err) {
    logger.debug(`Could not read state file "${statePath}": ${err}`);
    return null;
  }
}

async function isFolderOlderThan(folderPath: string, retentionMs: number, now: number): Promise<boolean> {
  try {
    const folderStat = await stat(folderPath);
    return now - folderStat.mtimeMs >= retentionMs;
  } catch (err) {
    logger.debug(`Could not stat folder "${folderPath}", assuming old enough to clean: ${err}`);
    return true;
  }
}

/**
 * Clean up stale session folders.
 * - Completed sessions are cleaned up when removeSession() is called
 * - Failed sessions are NEVER automatically cleaned up (kept for debugging until manual deletion)
 * - Active sessions (in-progress) are never cleaned up
 * - Orphaned folders (no state.json, no active session) are cleaned up after retention period
 *
 * Note: activeBranches is passed as a parameter to avoid circular dependency
 */
export async function cleanupStaleSessionFolders(
  retentionHours: number = 24,
  activeBranches?: Set<string>
): Promise<void> {
  const sessionsDir = getWorktreeSessionsDir();

  if (!existsSync(sessionsDir)) {
    return;
  }

  const now = Date.now();
  const retentionMs = retentionHours * 60 * 60 * 1000;
  let cleaned = 0;

  try {
    const folders = await readdir(sessionsDir);

    for (const folder of folders) {
      const folderPath = join(sessionsDir, folder);

      // Skip if not a directory
      try {
        if (!(await stat(folderPath)).isDirectory()) continue;
      } catch (err) {
        logger.debug(`Could not stat folder "${folder}" during cleanup: ${err}`);
        continue;
      }

      const state = await tryReadState(join(folderPath, "state.json"));
      const decision = shouldCleanupSession(state, folder, activeBranches);

      switch (decision.action) {
        case "skip":
          logger.debug(`Skipping cleanup: ${decision.reason}`);
          break;

        case "cleanup":
          if (await tryRemoveFolder(folderPath, folder, decision.label)) {
            cleaned++;
          }
          break;

        case "check_age":
          if (await isFolderOlderThan(folderPath, retentionMs, now)) {
            if (await tryRemoveFolder(folderPath, folder, decision.label)) {
              cleaned++;
            }
          }
          break;
      }
    }

    if (cleaned > 0) {
      logger.info(`Cleaned up ${cleaned} stale session folders`);
    }
  } catch (err) {
    logger.warn(`Failed to clean up session folders: ${err}`);
  }
}
