import type { WorkerToolContext } from "../types.js";
import { updateActiveChangeStatus, clearActiveChange } from "../../changes/activeState.js";
import { appendExecutionLog } from "../../changes/persistence.js";
import { removeWorktree, deleteBranch } from "../../worktrees.js";
import type { ChangeStatus } from "../../changes/types.js";

export interface CleanupAfterPRActionDeps {
  updateActiveChangeStatus: (sessionId: string, status: ChangeStatus) => void;
  clearActiveChange: (sessionId: string, cleanupFolder: boolean) => void;
  appendExecutionLog: (branchName: string, message: string) => void;
  removeWorktree: (repoName: string, worktreePath: string) => Promise<void>;
  deleteBranch: (repoName: string, branchName: string) => Promise<void>;
}

export const defaultCleanupAfterPRActionDeps: CleanupAfterPRActionDeps = {
  updateActiveChangeStatus,
  clearActiveChange,
  appendExecutionLog,
  removeWorktree,
  deleteBranch,
};

/**
 * Shared cleanup sequence after closing or merging a PR:
 * mark status completed, remove worktree, delete local branch, clear active change.
 */
export async function cleanupAfterPRAction(
  ctx: WorkerToolContext,
  logPrefix: string,
  deps: CleanupAfterPRActionDeps = defaultCleanupAfterPRActionDeps,
): Promise<void> {
  deps.updateActiveChangeStatus(ctx.sessionId, "completed");
  await deps.removeWorktree(ctx.repoName, ctx.worktreePath);
  await deps.deleteBranch(ctx.repoName, ctx.branchName);
  deps.clearActiveChange(ctx.sessionId, true);
  deps.appendExecutionLog(ctx.branchName, `${logPrefix}: cleanup complete`);
}
