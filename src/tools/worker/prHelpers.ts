import type { WorkerToolContext } from "../types.js";
import { updateActiveChangeStatus, clearActiveChange } from "../../changes/activeState.js";
import { appendExecutionLog } from "../../changes/persistence.js";
import { removeWorktree, deleteBranch } from "../../worktrees.js";

export interface ParsedPrUrl {
  owner: string;
  repo: string;
  pullNumber: number;
}

/**
 * Extract owner, repo, and pull number from a GitHub PR URL.
 * Returns null if the URL doesn't match the expected pattern.
 */
export function parsePrUrl(url: string): ParsedPrUrl | null {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!match) return null;

  const [, owner, repo, pullNumberStr] = match;
  return { owner, repo, pullNumber: parseInt(pullNumberStr, 10) };
}

/**
 * Shared cleanup sequence after closing or merging a PR:
 * mark status completed, remove worktree, delete local branch, clear active change.
 */
export async function cleanupAfterPrAction(ctx: WorkerToolContext, logPrefix: string): Promise<void> {
  updateActiveChangeStatus(ctx.sessionId, "completed");
  await removeWorktree(ctx.repoName, ctx.worktreePath);
  await deleteBranch(ctx.repoName, ctx.branchName);
  clearActiveChange(ctx.sessionId, true);
  appendExecutionLog(ctx.branchName, `${logPrefix}: cleanup complete`);
}
