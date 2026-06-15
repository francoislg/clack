import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { RepositoryConfig } from "../config.js";
import { getWorktreesDir } from "../config.js";
import { createWorktree, getExistingWorktree, removeWorktree } from "../worktrees.js";
import type { AcquireOptions, Worker, WorkerPool, ReleaseReason } from "./types.js";

/**
 * Disposable pool: preserves the pre-change behavior. Each acquire creates a fresh
 * branch-named worktree; each release rm -rf's it. `worker.id` is the branch-with-dashes.
 */
export class DisposablePool implements WorkerPool {
  async acquire(
    repo: RepositoryConfig,
    branch: string,
    sessionId: string,
    options?: AcquireOptions,
  ): Promise<Worker> {
    const existing = getExistingWorktree(repo, branch);
    const info = existing ?? (await createWorktree(repo, branch, options?.resumeRemoteBranch));
    return {
      id: branchToWorkerId(branch),
      repo: repo.name,
      worktreePath: info.worktreePath,
      currentBranch: branch,
      status: "busy",
      setupComplete: existing !== null,
      setupVersionHash: null,
      claimedBy: sessionId,
      lastUsedAt: new Date(),
      createdAt: info.createdAt,
    };
  }

  async release(worker: Worker, _reason: ReleaseReason): Promise<void> {
    await removeWorktree(worker.repo, worker.worktreePath);
  }

  findByBranch(repo: string, branch: string): Worker | null {
    const worktreesDir = getWorktreesDir();
    const path = resolve(worktreesDir, repo, branch.replace(/\//g, "-"));
    if (!existsSync(path)) return null;
    const stats = statSync(path);
    return {
      id: branchToWorkerId(branch),
      repo,
      worktreePath: path,
      currentBranch: branch,
      status: "idle",
      setupComplete: true,
      setupVersionHash: null,
      claimedBy: null,
      lastUsedAt: stats.mtime,
      createdAt: stats.birthtime,
    };
  }

  list(repo?: string): Worker[] {
    const worktreesDir = getWorktreesDir();
    if (!existsSync(worktreesDir)) return [];
    const repos = repo
      ? [repo]
      : readdirSync(worktreesDir).filter((name) =>
          statSync(join(worktreesDir, name)).isDirectory(),
        );
    const workers: Worker[] = [];
    for (const repoName of repos) {
      const repoDir = join(worktreesDir, repoName);
      if (!existsSync(repoDir)) continue;
      for (const entry of readdirSync(repoDir)) {
        const path = join(repoDir, entry);
        if (!statSync(path).isDirectory()) continue;
        const stats = statSync(path);
        workers.push({
          id: entry,
          repo: repoName,
          worktreePath: path,
          // Branch name lost in disposable mode (path → branch is the inverse mapping
          // but unreliable for branches with dashes). Leave null; consumers that need
          // it should consult the session's activeChange.
          currentBranch: null,
          status: "idle",
          setupComplete: true,
          setupVersionHash: null,
          claimedBy: null,
          lastUsedAt: stats.mtime,
          createdAt: stats.birthtime,
        });
      }
    }
    return workers;
  }

  async ensureMinimum(_repo: RepositoryConfig): Promise<void> {
    // No-op: disposable pool has no warm-up.
  }
}

function branchToWorkerId(branch: string): string {
  return branch.replace(/\//g, "-");
}
