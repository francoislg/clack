import type { ChangeStatus, ChangeSession } from "./types.js";
import type { WorktreeInfo } from "../worktrees.js";
import type { ClaudeRunHandle } from "../claude/runHandle.js";
import {
  writeSessionState,
  createSessionFolder,
  appendExecutionLog,
  removeSessionFolder,
  statusToPhase,
} from "./persistence.js";

// ============================================================================
// Dependency Injection
// ============================================================================

export interface ActiveStateDeps {
  writeSessionState: typeof writeSessionState;
  createSessionFolder: typeof createSessionFolder;
  appendExecutionLog: typeof appendExecutionLog;
  removeSessionFolder: typeof removeSessionFolder;
  statusToPhase: typeof statusToPhase;
}

export const defaultActiveStateDeps: ActiveStateDeps = {
  writeSessionState,
  createSessionFolder,
  appendExecutionLog,
  removeSessionFolder,
  statusToPhase,
};

/** Module-level deps, overridable for testing */
let deps: ActiveStateDeps = defaultActiveStateDeps;

export function setActiveStateDeps(d: ActiveStateDeps): void {
  deps = d;
}

export function resetActiveStateDeps(): void {
  deps = defaultActiveStateDeps;
}

// ============================================================================
// Types
// ============================================================================

export interface ActiveChangeState {
  branch: string;
  repo: string;
  description: string;
  worktree?: WorktreeInfo;
  status: ChangeStatus;
  prUrl?: string;
  startedAt: Date;
  lastActivityAt: Date;
  /** SDK session ID for resuming change executions across follow-ups */
  sdkSessionId?: string;
  /**
   * Runtime-only: live `ClaudeRunHandle` for the in-flight execution. Used by
   * `cancel_worker_run` and Slack-side stop paths to invoke `handle.stop(reason)`. Cleared
   * by the workflow's `finally` block when the run terminates. Replaces the prior
   * `abortController` field — the handle owns its own AbortController internally.
   */
  handle?: ClaudeRunHandle;
  /** Runtime-only: set by cancel tool before abort, checked by workflow after execution returns */
  cancelledBy?: { userId: string; reason?: string };
  /**
   * Number of times the verification gate has failed for this change.
   * Persisted so the counter survives process restarts within a single change
   * session. Bounded by the configured `retryBudget`.
   */
  verificationAttempts?: number;
}

export interface ActiveWorker {
  id: string;
  userId: string;
  status: ChangeStatus;
  description: string;
  branch: string;
  repo: string;
  prUrl?: string;
  channel: string;
  threadTs: string;
  startedAt: Date;
}

/** Minimal session fields needed by active change operations for persistence */
export interface SessionRef {
  userId: string;
  channelId: string;
  threadTs: string;
  triggerType?: string;
}

// ============================================================================
// In-Memory State
// ============================================================================

/** Active change state, keyed by Q&A session ID */
const activeChanges = new Map<string, ActiveChangeState>();

/** Cached session references for persistence, keyed by session ID */
const sessionRefs = new Map<string, SessionRef>();

// ============================================================================
// Internal Helpers
// ============================================================================

function buildChangeSessionForPersistence(
  sessionId: string,
  change: ActiveChangeState,
  ref: SessionRef,
): ChangeSession {
  return {
    id: sessionId,
    userId: ref.userId,
    request: {
      userId: ref.userId,
      message: change.description,
      triggerType: (ref.triggerType as "reactions" | "mentions" | "directMessages") ?? "reactions",
      channel: ref.channelId,
      messageTs: ref.threadTs,
    },
    plan: {
      branchName: change.branch,
      description: change.description,
      targetRepo: change.repo,
    },
    worktree: change.worktree,
    prUrl: change.prUrl,
    status: change.status,
    createdAt: change.startedAt,
    lastActivityAt: change.lastActivityAt,
    channel: ref.channelId,
    threadTs: ref.threadTs,
    ...(change.cancelledBy && { cancelledBy: change.cancelledBy }),
    ...(change.verificationAttempts !== undefined && {
      verificationAttempts: change.verificationAttempts,
    }),
  };
}

// ============================================================================
// Public API
// ============================================================================

export function getActiveChange(sessionId: string): ActiveChangeState | undefined {
  return activeChanges.get(sessionId);
}

export function setActiveChange(
  sessionId: string,
  change: ActiveChangeState,
  ref: SessionRef,
): void {
  activeChanges.set(sessionId, change);
  sessionRefs.set(sessionId, ref);
  const cs = buildChangeSessionForPersistence(sessionId, change, ref);
  deps.createSessionFolder(cs);
  deps.appendExecutionLog(change.branch, "Phase: starting");
}

export function clearActiveChange(sessionId: string, cleanupFolder: boolean = false): void {
  const change = activeChanges.get(sessionId);
  activeChanges.delete(sessionId);
  sessionRefs.delete(sessionId);
  if (cleanupFolder && change) {
    deps.removeSessionFolder(change.branch);
  }
}

export function updateActiveChangeStatus(
  sessionId: string,
  status: ChangeStatus,
  lastMessage?: string,
): void {
  const change = activeChanges.get(sessionId);
  const ref = sessionRefs.get(sessionId);
  if (change && ref) {
    change.status = status;
    change.lastActivityAt = new Date();
    const message = lastMessage ?? `Status changed to: ${status}`;
    const cs = buildChangeSessionForPersistence(sessionId, change, ref);
    deps.writeSessionState(cs, message);
    deps.appendExecutionLog(change.branch, `Phase: ${deps.statusToPhase(status)}`);
  }
}

export function updateActiveChangePrUrl(sessionId: string, prUrl: string): void {
  const change = activeChanges.get(sessionId);
  const ref = sessionRefs.get(sessionId);
  if (change && ref) {
    change.prUrl = prUrl;
    change.lastActivityAt = new Date();
    const cs = buildChangeSessionForPersistence(sessionId, change, ref);
    deps.writeSessionState(cs, `PR created: ${prUrl}`);
    deps.appendExecutionLog(change.branch, `PR URL: ${prUrl}`);
  }
}

/**
 * Find an actively-executing change for a user.
 * Only returns changes consuming compute (executing, reviewing, merging).
 * Changes in pr_created state are idle and do NOT block new changes.
 */
export function getActiveChangeForUser(
  userId: string,
): { sessionId: string; change: ActiveChangeState } | undefined {
  const activelyExecutingStatuses: ChangeStatus[] = ["executing", "reviewing", "merging"];
  for (const [sessionId, change] of activeChanges.entries()) {
    const ref = sessionRefs.get(sessionId);
    if (ref && ref.userId === userId && activelyExecutingStatuses.includes(change.status)) {
      return { sessionId, change };
    }
  }
  return undefined;
}

/**
 * Get all active change workers for display purposes.
 */
export function getActiveWorkers(): ActiveWorker[] {
  const workers: ActiveWorker[] = [];

  for (const [sessionId, change] of activeChanges.entries()) {
    if (change.status !== "completed" && change.status !== "failed") {
      const ref = sessionRefs.get(sessionId);
      if (ref) {
        workers.push({
          id: sessionId,
          userId: ref.userId,
          status: change.status,
          description: change.description,
          branch: change.branch,
          repo: change.repo,
          prUrl: change.prUrl,
          channel: ref.channelId,
          threadTs: ref.threadTs,
          startedAt: change.startedAt,
        });
      }
    }
  }

  workers.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  return workers;
}

/**
 * Get the set of branches that have active (non-terminal) changes.
 * Used by worktree cleanup to avoid removing worktrees for active sessions.
 */
export function getActiveChangeBranches(): Set<string> {
  const branches = new Set<string>();
  for (const change of activeChanges.values()) {
    if (change.status !== "completed" && change.status !== "failed") {
      branches.add(change.branch);
    }
  }
  return branches;
}
