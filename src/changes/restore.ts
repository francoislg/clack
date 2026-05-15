import { getConfig, type RepositoryConfig } from "../config.js";
import { logger } from "../logger.js";
import { getAllPersistedSessions, writeSessionState } from "./persistence.js";
import type { ChangeStatus, PersistedSessionState, WriteableSessionState } from "./types.js";
import { findSessionByThread } from "../sessions.js";
import { setActiveChange } from "./activeState.js";
import { lazyDefaultPool } from "../workers/index.js";
import { workerToWorktreeInfo, type WorkerPool } from "../workers/types.js";
import type { WorktreeInfo } from "../worktrees.js";

// ============================================================================
// Dependency Injection
// ============================================================================

export interface RestoreDeps {
  getConfig: typeof getConfig;
  pool: WorkerPool;
  getAllPersistedSessions: typeof getAllPersistedSessions;
  writeSessionState: typeof writeSessionState;
  findSessionByThread: typeof findSessionByThread;
  setActiveChange: typeof setActiveChange;
}

export const defaultRestoreDeps: RestoreDeps = {
  getConfig,
  pool: lazyDefaultPool(),
  getAllPersistedSessions,
  writeSessionState,
  findSessionByThread,
  setActiveChange,
};

/**
 * Statuses that indicate a session was mid-execution when the process died.
 * These are non-terminal but the agent is gone after restart.
 */
const MID_EXECUTION_STATUSES: ChangeStatus[] = ["executing", "planning", "reviewing", "merging"];

interface RestorationContext {
  reposByName: Map<string, RepositoryConfig>;
}

type RestorationOutcome =
  | { action: "skip" }
  | { action: "fail" }
  | {
      action: "restore";
      effectiveStatus: ChangeStatus;
      repo: RepositoryConfig;
      /** Set when a worker holds the branch; null when detached (reusable mode only). */
      worktree: WorktreeInfo | null;
    };

function classifySession(
  state: PersistedSessionState,
  ctx: RestorationContext,
  restoreDeps: RestoreDeps,
): RestorationOutcome {
  if (state.status === "completed" || state.status === "failed" || state.status === "cancelled")
    return { action: "skip" };
  if (!state.channel || !state.threadTs) return { action: "skip" };

  const repo = ctx.reposByName.get(state.repo);
  if (!repo) {
    logger.debug(`Skipping session ${state.sessionId}: repo "${state.repo}" no longer configured`);
    return { action: "skip" };
  }

  const worker = restoreDeps.pool.findByBranch(repo.name, state.branch);
  const worktree = worker ? workerToWorktreeInfo(worker) : null;
  const reusableMode = restoreDeps.getConfig().changesWorkflow?.reusableFolders?.enabled === true;

  // Disposable mode: no matching worker means the worktree was deleted — skip.
  // Reusable mode: detach if the branch isn't on any worker; the next follow-up will re-acquire.
  if (!worktree && !reusableMode) {
    logger.debug(`Skipping session ${state.sessionId}: worktree for "${state.branch}" not found`);
    return { action: "skip" };
  }

  if (MID_EXECUTION_STATUSES.includes(state.status)) {
    if (state.prUrl) {
      return { action: "restore", effectiveStatus: "pr_created", repo, worktree };
    }
    return { action: "fail" };
  }

  return { action: "restore", effectiveStatus: state.status, repo, worktree };
}

/**
 * Restore persisted worker sessions into the unified session model on startup.
 *
 * - `pr_created`: Restore activeChange into the matching unified session
 * - Mid-execution with PR: Restore as `pr_created` (agent dead but PR trackable)
 * - Mid-execution without PR: Mark failed on disk, skip (no PR to track)
 * - `completed`/`failed`: Skip (terminal states)
 * - Missing `channel`/`threadTs`: Skip (legacy data)
 * - Worktree gone or repo removed: Skip
 * - No matching unified session: Skip (session was cleaned up)
 */
export async function restoreWorkerSessions(deps: RestoreDeps = defaultRestoreDeps): Promise<void> {
  const states = await deps.getAllPersistedSessions();
  if (states.length === 0) return;

  const config = deps.getConfig();
  const ctx: RestorationContext = {
    reposByName: new Map(config.repositories.map((r) => [r.name, r])),
  };

  // Process restorable sessions newest-first so that when two sessions reference
  // the same branch, the most-recently-active one wins the worker claim. Older
  // siblings are restored as detached and will re-acquire on next follow-up.
  // Stable sort: when timestamps tie, persisted order breaks the tie.
  const sortedStates = [...states].sort(
    (a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime(),
  );

  // Tracks which (repo, branch) pairs have already claimed their worker in this
  // restore pass — the second session referencing the same branch is detached.
  const claimedBranches = new Map<string, string>(); // key=`${repo}/${branch}`, value=winning sessionId

  let restored = 0;
  let skipped = 0;
  let downgraded = 0;
  let markedFailed = 0;
  let conflictsResolved = 0;

  for (const state of sortedStates) {
    const outcome = classifySession(state, ctx, deps);

    if (outcome.action === "skip") {
      skipped++;
      continue;
    }
    if (outcome.action === "fail") {
      markSessionFailed(state, deps);
      markedFailed++;
      continue;
    }

    let { effectiveStatus, worktree } = outcome;

    // Conflict detection: if another (newer) session in this restore pass
    // already claimed this branch, surrender our worktree binding and restore
    // as detached. The branch is still on the activeChange for re-acquisition.
    if (worktree) {
      const key = `${state.repo}/${state.branch}`;
      const winner = claimedBranches.get(key);
      if (winner && winner !== state.sessionId) {
        logger.warn(
          `Restore conflict on ${key}: session ${state.sessionId} loses to ${winner} ` +
            `(both reference the same branch). Loser will be restored as detached.`,
        );
        worktree = null;
        conflictsResolved++;
      } else {
        claimedBranches.set(key, state.sessionId);
      }
    }

    const wasDowngraded = effectiveStatus !== state.status;
    if (wasDowngraded) downgraded++;

    const unifiedSession = await deps.findSessionByThread(state.channel!, state.threadTs!);
    if (!unifiedSession) {
      logger.debug(
        `Skipping session ${state.sessionId}: no matching unified session for ${state.channel}:${state.threadTs}`,
      );
      skipped++;
      continue;
    }

    deps.setActiveChange(
      unifiedSession.sessionId,
      {
        branch: state.branch,
        repo: state.repo,
        description: state.description,
        worktree: worktree ?? undefined,
        status: effectiveStatus,
        prUrl: state.prUrl ?? undefined,
        startedAt: new Date(state.startedAt),
        lastActivityAt: new Date(state.lastActivityAt),
        ...(state.verificationAttempts !== undefined && {
          verificationAttempts: state.verificationAttempts,
        }),
      },
      {
        userId: unifiedSession.userId,
        channelId: unifiedSession.channelId,
        threadTs: unifiedSession.threadTs,
        triggerType: unifiedSession.triggerType,
      },
    );

    if (wasDowngraded) {
      const restoredState: WriteableSessionState = {
        id: unifiedSession.sessionId,
        userId: unifiedSession.userId,
        plan: { branchName: state.branch, description: state.description, targetRepo: state.repo },
        prUrl: state.prUrl ?? undefined,
        status: effectiveStatus,
        createdAt: new Date(state.startedAt),
        lastActivityAt: new Date(state.lastActivityAt),
        channel: state.channel!,
        threadTs: state.threadTs!,
      };
      deps.writeSessionState(
        restoredState,
        `Restored on startup (was ${state.status}, downgraded to ${effectiveStatus})`,
      );
    }

    restored++;
  }

  if (restored > 0 || downgraded > 0 || markedFailed > 0 || conflictsResolved > 0) {
    logger.info(
      `Worker sessions restored: ${restored} restored, ${downgraded} downgraded to pr_created, ${markedFailed} marked failed, ${conflictsResolved} branch conflicts resolved, ${skipped} skipped`,
    );
  }
}

/**
 * Mark a mid-execution session (no PR) as failed on disk.
 * The worktree is preserved for manual re-request.
 */
function markSessionFailed(state: PersistedSessionState, deps: RestoreDeps): void {
  const failedState: WriteableSessionState = {
    id: state.sessionId,
    userId: state.userId,
    plan: {
      branchName: state.branch,
      description: state.description,
      targetRepo: state.repo,
    },
    prUrl: state.prUrl ?? undefined,
    status: "failed",
    createdAt: new Date(state.startedAt),
    lastActivityAt: new Date(),
    channel: state.channel ?? "",
    threadTs: state.threadTs ?? "",
  };

  deps.writeSessionState(failedState, "Marked failed on startup: agent interrupted without PR");
}
