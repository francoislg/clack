import type { WorkerToolContext } from "../types.js";
import { updateActiveChangeStatus, clearActiveChange } from "../../changes/activeState.js";
import { appendExecutionLog } from "../../changes/persistence.js";
import { removeWorktree, deleteBranch } from "../../worktrees.js";

/**
 * Shared cleanup sequence after closing or merging a PR:
 * mark status completed, remove worktree, delete local branch, clear active change.
 */
export async function cleanupAfterPRAction(
  ctx: WorkerToolContext,
  logPrefix: string,
): Promise<void> {
  updateActiveChangeStatus(ctx.sessionId, "completed");
  await removeWorktree(ctx.repoName, ctx.worktreePath);
  await deleteBranch(ctx.repoName, ctx.branchName);
  clearActiveChange(ctx.sessionId, true);
  appendExecutionLog(ctx.branchName, `${logPrefix}: cleanup complete`);
}
