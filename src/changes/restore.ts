import { getConfig, type RepositoryConfig } from "../config.js";
import { logger } from "../logger.js";
import { getExistingWorktree } from "../worktrees.js";
import { getAllPersistedSessions, writeSessionState } from "./persistence.js";
import { restoreSession } from "./session.js";
import type { ChangeSession, ChangeStatus, PersistedSessionState } from "./types.js";

/**
 * Statuses that indicate a session was mid-execution when the process died.
 * These are non-terminal but the agent is gone after restart.
 */
const MID_EXECUTION_STATUSES: ChangeStatus[] = ["executing", "planning", "reviewing", "merging"];

/**
 * Restore persisted worker sessions into memory on startup.
 *
 * - `pr_created`: Restore as-is (has an open PR, user needs follow-up buttons)
 * - Mid-execution with PR: Restore as `pr_created` (agent dead but PR trackable)
 * - Mid-execution without PR: Mark failed on disk, skip (no PR to track)
 * - `completed`/`failed`: Skip (terminal states)
 * - Missing `channel`/`threadTs`: Skip (legacy data)
 * - Worktree gone or repo removed: Skip
 */
export function restoreWorkerSessions(): void {
  const states = getAllPersistedSessions();

  if (states.length === 0) {
    return;
  }

  const config = getConfig();
  const reposByName = new Map<string, RepositoryConfig>(
    config.repositories.map((r) => [r.name, r]),
  );

  let restored = 0;
  let skipped = 0;
  let downgraded = 0;
  let markedFailed = 0;

  for (const state of states) {
    // Skip terminal states
    if (state.status === "completed" || state.status === "failed") {
      skipped++;
      continue;
    }

    // Skip sessions missing Slack references (legacy data)
    if (!state.channel || !state.threadTs) {
      skipped++;
      continue;
    }

    // Validate repo still exists in config
    const repo = reposByName.get(state.repo);
    if (!repo) {
      logger.debug(`Skipping session ${state.sessionId}: repo "${state.repo}" no longer configured`);
      skipped++;
      continue;
    }

    // Validate worktree still exists on disk
    const worktree = getExistingWorktree(repo, state.branch);
    if (!worktree) {
      logger.debug(`Skipping session ${state.sessionId}: worktree for "${state.branch}" not found`);
      skipped++;
      continue;
    }

    // Determine effective status for restoration
    let effectiveStatus: ChangeStatus = state.status;

    if (MID_EXECUTION_STATUSES.includes(state.status)) {
      if (state.prUrl) {
        // Agent dead but PR exists — downgrade to pr_created
        effectiveStatus = "pr_created";
        downgraded++;
      } else {
        // Agent dead and no PR — mark failed, skip
        markSessionFailed(state);
        markedFailed++;
        continue;
      }
    }

    // Reconstruct the ChangeSession
    const session: ChangeSession = {
      id: state.sessionId,
      userId: state.userId,
      request: {
        userId: state.userId,
        message: state.description,
        triggerType: "reactions",
        channel: state.channel,
        messageTs: state.threadTs,
      },
      plan: {
        branchName: state.branch,
        description: state.description,
        targetRepo: state.repo,
      },
      worktree,
      prUrl: state.prUrl ?? undefined,
      status: effectiveStatus,
      createdAt: new Date(state.startedAt),
      lastActivityAt: new Date(state.lastActivityAt),
      channel: state.channel,
      threadTs: state.threadTs,
    };

    restoreSession(session);

    // If we downgraded, persist the new status
    if (effectiveStatus !== state.status) {
      writeSessionState(session, `Restored on startup (was ${state.status}, downgraded to ${effectiveStatus})`);
    }

    restored++;
  }

  if (restored > 0 || downgraded > 0 || markedFailed > 0) {
    logger.info(
      `Worker sessions restored: ${restored} restored, ${downgraded} downgraded to pr_created, ${markedFailed} marked failed, ${skipped} skipped`,
    );
  }
}

/**
 * Mark a mid-execution session (no PR) as failed on disk.
 * The worktree is preserved for manual re-request.
 */
function markSessionFailed(state: PersistedSessionState): void {
  // Build a minimal ChangeSession just for writeSessionState
  const minimalSession = {
    id: state.sessionId,
    userId: state.userId,
    plan: {
      branchName: state.branch,
      description: state.description,
      targetRepo: state.repo,
    },
    prUrl: state.prUrl ?? undefined,
    status: "failed" as ChangeStatus,
    createdAt: new Date(state.startedAt),
    lastActivityAt: new Date(),
    channel: state.channel ?? "",
    threadTs: state.threadTs ?? "",
  } as ChangeSession;

  writeSessionState(minimalSession, "Marked failed on startup: agent interrupted without PR");
}
