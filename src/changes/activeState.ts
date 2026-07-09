import type { ChangeKind, ChangeStatus, ChangeSession } from "./types.js";
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
  /** Run kind: `"test"` marks a tester (QA) run — no PR, no follow-up actions. */
  kind?: ChangeKind;
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
   * Runtime-only: set while the change is parked in the pool's acquire queue (driven by the
   * pool's `onQueued` seam) and cleared the moment a worker is handed out. Lets query tools
   * distinguish a change waiting for execution capacity from one actively running, without
   * consulting pool internals. The disposable pool never enqueues, so this stays unset there.
   */
  waiting?: { since: Date };
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
  /** True while the change is parked in the pool's acquire queue. */
  waiting: boolean;
  lastActivityAt: Date;
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

/**
 * Sessions whose change was adopted into another conversation, mapped to the new
 * home's ref. In-memory only: after a restart the old thread's buttons fall back
 * to the generic no-active-change message, which is acceptable for a thread the
 * user already moved away from.
 */
const adoptedAway = new Map<string, SessionRef>();

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

export function getActiveChangeRef(sessionId: string): SessionRef | undefined {
  return sessionRefs.get(sessionId);
}

export function findActiveChangeByBranch(
  repo: string,
  branch: string,
): { sessionId: string; change: ActiveChangeState } | undefined {
  for (const [sessionId, change] of activeChanges.entries()) {
    if (change.repo === repo && change.branch === branch) {
      return { sessionId, change };
    }
  }
  return undefined;
}

export type ChangeSessionLiveness = "live" | "adoptable" | "orphan";

/**
 * Classify a change session's claim for cross-conversation continuation.
 * "live" — a run is executing (or queued); the change must not be moved or detached.
 * "adoptable" — the session exists but is parked (pr_created/failed/terminal, no run).
 * "orphan" — no active change for this sessionId (expired or not restored).
 */
export function classifyChangeSession(sessionId: string): ChangeSessionLiveness {
  const change = activeChanges.get(sessionId);
  if (!change) return "orphan";
  if (
    change.handle !== undefined ||
    change.waiting !== undefined ||
    ACTIVELY_EXECUTING_STATUSES.includes(change.status)
  ) {
    return "live";
  }
  return "adoptable";
}

/**
 * Re-home a change session into another conversation: the activeChange and its
 * ref move to the new sessionId, the branch-keyed persisted session is rewritten
 * with the new channel/threadTs (so restore rebinds after a restart), and the old
 * sessionId gets a tombstone pointing at the new home.
 */
export function adoptActiveChange(
  oldSessionId: string,
  newSessionId: string,
  newRef: SessionRef,
): void {
  const change = activeChanges.get(oldSessionId);
  if (!change) return;
  activeChanges.delete(oldSessionId);
  sessionRefs.delete(oldSessionId);
  activeChanges.set(newSessionId, change);
  sessionRefs.set(newSessionId, newRef);
  adoptedAway.set(oldSessionId, newRef);
  adoptedAway.delete(newSessionId);
  change.lastActivityAt = new Date();
  const cs = buildChangeSessionForPersistence(newSessionId, change, newRef);
  deps.writeSessionState(cs, `Adopted into ${newRef.channelId}`);
  deps.appendExecutionLog(
    change.branch,
    `Session adopted: ${oldSessionId} -> ${newSessionId} (channel ${newRef.channelId})`,
  );
}

export function getAdoptedAwayRef(sessionId: string): SessionRef | undefined {
  return adoptedAway.get(sessionId);
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

/**
 * Detach a session's worktree binding. Used by the idle-release sweep in
 * reusable mode: the worker is freed back to the pool but the session stays
 * alive with its branch intact. The next follow-up command re-acquires a
 * worker (same or different) and re-binds via `setActiveChange`/direct mutation.
 */
export function detachActiveChangeWorktree(sessionId: string): void {
  const change = activeChanges.get(sessionId);
  if (!change) return;
  change.worktree = undefined;
  change.lastActivityAt = new Date();
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
 * Statuses that count as "actively executing" — these consume compute and gate
 * concurrent requests. Idle states (`pr_created`, `completed`, `failed`,
 * `cancelled`) are intentionally excluded.
 */
const ACTIVELY_EXECUTING_STATUSES: ChangeStatus[] = ["executing", "reviewing", "merging"];

/**
 * Find an actively-executing change for a user.
 * Only returns changes consuming compute (executing, reviewing, merging).
 * Changes in pr_created state are idle and do NOT block new changes.
 */
export function getActiveChangeForUser(
  userId: string,
): { sessionId: string; change: ActiveChangeState } | undefined {
  for (const [sessionId, change] of activeChanges.entries()) {
    const ref = sessionRefs.get(sessionId);
    if (ref && ref.userId === userId && ACTIVELY_EXECUTING_STATUSES.includes(change.status)) {
      return { sessionId, change };
    }
  }
  return undefined;
}

/**
 * Count actively-executing changes for a user. Same status set as
 * `getActiveChangeForUser`. Used by `startChangeWorkflow` to enforce the
 * `changesWorkflow.maxActiveChangesPerUser` cap (0 = unlimited).
 */
export function countActiveChangesForUser(userId: string): number {
  let count = 0;
  for (const [sessionId, change] of activeChanges.entries()) {
    const ref = sessionRefs.get(sessionId);
    if (ref && ref.userId === userId && ACTIVELY_EXECUTING_STATUSES.includes(change.status)) {
      count++;
    }
  }
  return count;
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
          waiting: change.waiting != null,
          lastActivityAt: change.lastActivityAt,
        });
      }
    }
  }

  workers.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  return workers;
}

/** One executing Changes-Workflow run, as surfaced by `snapshotRunningChanges()`. */
export interface RunningChangeInfo {
  repo: string;
  branch: string;
  status: ChangeStatus;
  ageMs: number;
}

/**
 * Snapshot the Changes-Workflow runs that are currently EXECUTING Claude — i.e. changes
 * whose live run handle is `"running"`. Mode-independent (holds for both disposable and
 * reusable pools). A change that exists but is not executing (e.g. `pr_created` awaiting a
 * follow-up, where `handle` is cleared) is deliberately excluded, so the count reflects
 * in-flight work that a deploy would interrupt — not idle sessions.
 */
export function snapshotRunningChanges(): { active: number; changes: RunningChangeInfo[] } {
  const now = Date.now();
  const changes: RunningChangeInfo[] = [];
  for (const change of activeChanges.values()) {
    if (change.handle?.status === "running") {
      changes.push({
        repo: change.repo,
        branch: change.branch,
        status: change.status,
        ageMs: Math.max(0, now - change.startedAt.getTime()),
      });
    }
  }
  return { active: changes.length, changes };
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
