import type { RepositoryConfig } from "../config.js";
import { logger } from "../logger.js";
import { errorMessage } from "../errors.js";
import { getGitInstance, setAuthenticatedRemote } from "../repositories.js";
import type { Worker } from "./types.js";
import { DirtyWorkerQuarantined } from "./errors.js";
import { getDirtyTrackedFiles, writeQuarantineRecord } from "./quarantine.js";

/**
 * Switch a worker's checked-out branch. If the worker has modified-tracked files,
 * the worker is quarantined and `DirtyWorkerQuarantined` is thrown — the caller
 * is expected to skip this worker and try another (or grow the pool).
 *
 * Untracked files (build outputs, node_modules, .env.local) are preserved
 * across the switch — that warmth is the whole point of the pool.
 */
export async function switchBranch(
  worker: Worker,
  repo: RepositoryConfig,
  newBranch: string,
): Promise<void> {
  if (worker.currentBranch === newBranch) {
    // Same branch: skip both fetch and dirty-check; keep in-progress state.
    return;
  }

  const dirtyFiles = await getDirtyTrackedFiles(worker);
  if (dirtyFiles.length > 0) {
    writeQuarantineRecord(worker, dirtyFiles);
    worker.status = "quarantined";
    throw new DirtyWorkerQuarantined(worker.id, dirtyFiles);
  }

  await setAuthenticatedRemote(worker.worktreePath, repo.url);
  const git = getGitInstance(worker.worktreePath);
  const defaultBranch = repo.branch || "main";

  try {
    await git.fetch(["--all"]);
  } catch (err) {
    logger.warn(`fetch failed in ${worker.worktreePath}: ${errorMessage(err)}`);
  }

  // Delete the local branch first if it exists from a prior unrelated session.
  try {
    const branches = await git.branchLocal();
    if (branches.all.includes(newBranch)) {
      await git.raw(["branch", "-D", newBranch]);
    }
  } catch (err) {
    logger.debug(`branch -D ${newBranch} skipped: ${errorMessage(err)}`);
  }

  await git.raw(["checkout", "-B", newBranch, `origin/${defaultBranch}`]);
  worker.currentBranch = newBranch;
}

/**
 * Switch a worker back to the default branch (used during idle release / detach).
 * Quarantines if dirty.
 */
export async function switchToDefault(worker: Worker, repo: RepositoryConfig): Promise<void> {
  const defaultBranch = repo.branch || "main";
  if (worker.currentBranch === defaultBranch) return;

  const dirtyFiles = await getDirtyTrackedFiles(worker);
  if (dirtyFiles.length > 0) {
    writeQuarantineRecord(worker, dirtyFiles);
    worker.status = "quarantined";
    throw new DirtyWorkerQuarantined(worker.id, dirtyFiles);
  }

  await setAuthenticatedRemote(worker.worktreePath, repo.url);
  const git = getGitInstance(worker.worktreePath);

  try {
    await git.fetch(["--all"]);
  } catch (err) {
    logger.warn(`fetch failed in ${worker.worktreePath}: ${errorMessage(err)}`);
  }

  await git.raw(["checkout", `origin/${defaultBranch}`]);
  worker.currentBranch = null; // detached HEAD on origin/<defaultBranch>
}
