import type { ActiveChangeState } from "./activeState.js";
import type { Worker, WorkerPool } from "../workers/types.js";

/**
 * Look up the pool's `Worker` record corresponding to an `ActiveChangeState.worktree`.
 * Falls back to synthesizing a Worker from the worktree info (disposable mode, where
 * the path-derived match is the whole story). Returns null when the change has no
 * worktree bound.
 */
export function poolWorkerForChange(
  activeChange: ActiveChangeState,
  pool: WorkerPool,
): Worker | null {
  if (!activeChange.worktree) return null;
  const byBranch = pool.findByBranch(
    activeChange.worktree.repoName,
    activeChange.worktree.branchName,
  );
  if (byBranch) return byBranch;
  return {
    id: activeChange.worktree.branchName.replace(/\//g, "-"),
    repo: activeChange.worktree.repoName,
    worktreePath: activeChange.worktree.worktreePath,
    currentBranch: activeChange.worktree.branchName,
    status: "busy",
    setupComplete: true,
    setupVersionHash: null,
    claimedBy: null,
    lastUsedAt: new Date(),
    createdAt: activeChange.worktree.createdAt,
  };
}
