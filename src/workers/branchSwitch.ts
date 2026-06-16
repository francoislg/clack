import type { RepositoryConfig } from "../config.js";
import { logger } from "../logger.js";
import { errorMessage } from "../errors.js";
import { getGitInstance, setAuthenticatedRemote } from "../repositories.js";
import type { Worker } from "./types.js";
import { DirtyWorkerQuarantined, RemoteBranchNotFound, RemoteBranchUnreachable } from "./errors.js";
import { getDirtyTrackedFiles, writeQuarantineRecord } from "./quarantine.js";

/**
 * Switch a worker's checked-out branch. If the worker has modified-tracked files,
 * the worker is quarantined and `DirtyWorkerQuarantined` is thrown — the caller
 * is expected to skip this worker and try another (or grow the pool).
 *
 * Untracked files (build outputs, node_modules, .env.local) are preserved
 * across the switch — that warmth is the whole point of the pool.
 *
 * When `resumeRemoteBranch` is true, the branch is checked out from its OWN remote head
 * (`origin/<newBranch>`) instead of the default branch, so an existing PR's commits are
 * preserved (continuation). If that remote branch is gone, `RemoteBranchNotFound` is thrown
 * rather than silently resetting to the default branch.
 */
export async function switchBranch(
  worker: Worker,
  repo: RepositoryConfig,
  newBranch: string,
  resumeRemoteBranch = false,
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

  const base = resumeRemoteBranch
    ? await resolveRemoteBase(git, repo.name, newBranch)
    : `origin/${defaultBranch}`;
  await git.raw(["checkout", "-B", newBranch, base]);
  worker.currentBranch = newBranch;
}

/**
 * Resolve `origin/<branch>` for a resume, asserting it exists rather than clobbering from default.
 *
 * Shallow clones imply `--single-branch`, so a blanket `fetch --all` never refreshes other
 * branches' remote-tracking refs — the branch can be alive on the remote yet invisible here.
 * Fetch the target branch by name to populate `origin/<branch>` before resolving it, and
 * distinguish a genuinely deleted branch (`RemoteBranchNotFound`) from an unreachable remote
 * (`RemoteBranchUnreachable`) so the user gets an accurate message.
 */
export async function resolveRemoteBase(
  git: ReturnType<typeof getGitInstance>,
  repoName: string,
  branch: string,
): Promise<string> {
  let fetchError: unknown;
  try {
    await git.fetch("origin", `${branch}:refs/remotes/origin/${branch}`);
  } catch (err) {
    fetchError = err;
  }

  try {
    const remotes = await git.branch(["-r"]);
    if (remotes.all.includes(`origin/${branch}`)) {
      return `origin/${branch}`;
    }
  } catch (err) {
    logger.warn(`remote branch lookup failed for ${branch}: ${errorMessage(err)}`);
  }

  // The branch isn't present locally. If the targeted fetch failed for a reason OTHER than
  // a missing ref (auth, network), surface that instead of the misleading "branch deleted".
  if (fetchError && !isMissingRemoteRef(fetchError)) {
    throw new RemoteBranchUnreachable(repoName, branch, errorMessage(fetchError));
  }
  throw new RemoteBranchNotFound(repoName, branch);
}

/** Git's error text when a fetched ref simply doesn't exist on the remote. */
function isMissingRemoteRef(err: unknown): boolean {
  return /couldn't find remote ref|no such ref|not found in upstream/i.test(errorMessage(err));
}

/**
 * Hard-reset a worker's worktree and re-create the branch from `origin/<default>`.
 * Used by the Start-over recovery action: the dev explicitly chose to scrap the
 * in-progress work, so uncommitted edits, untracked files, and local commits are
 * all discarded WITHOUT the dirty-quarantine protection.
 */
export async function forceResetBranch(
  worker: Worker,
  repo: RepositoryConfig,
  branch: string,
): Promise<void> {
  await setAuthenticatedRemote(worker.worktreePath, repo.url);
  const git = getGitInstance(worker.worktreePath);
  const defaultBranch = repo.branch || "main";

  try {
    await git.fetch(["--all"]);
  } catch (err) {
    logger.warn(`fetch failed in ${worker.worktreePath}: ${errorMessage(err)}`);
  }

  await git.raw(["reset", "--hard", "HEAD"]);
  await git.raw(["clean", "-fd"]);
  await git.raw(["checkout", "-B", branch, `origin/${defaultBranch}`]);
  worker.currentBranch = branch;
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
