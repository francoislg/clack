import { existsSync, mkdirSync, rmSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import {
  getConfig,
  getRepositoriesDir,
  getWorktreesDir,
  getWorktreeSessionsDir,
  type RepositoryConfig,
} from "./config.js";
import { logger } from "./logger.js";
import { errorMessage } from "./errors.js";
import { getGitInstance, setAuthenticatedRemote } from "./repositories.js";

/**
 * Find the repository config by name to get its URL for token auth.
 */
function findRepoConfig(repoName: string): RepositoryConfig | undefined {
  const config = getConfig();
  return config.repositories.find((r) => r.name === repoName);
}

export interface WorktreeInfo {
  repoName: string;
  branchName: string;
  worktreePath: string;
  createdAt: Date;
}

/**
 * Check if a worktree exists and return its info if so
 */
export function getExistingWorktree(
  repo: RepositoryConfig,
  branchName: string,
): WorktreeInfo | null {
  const worktreesDir = getWorktreesDir();
  const repoWorktreesDir = resolve(worktreesDir, repo.name);
  const worktreePath = resolve(repoWorktreesDir, branchName.replace(/\//g, "-"));

  if (existsSync(worktreePath)) {
    try {
      const stats = statSync(worktreePath);
      return {
        repoName: repo.name,
        branchName,
        worktreePath,
        createdAt: stats.birthtime,
      };
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Create a worktree for a repository
 */
export async function createWorktree(
  repo: RepositoryConfig,
  branchName: string,
): Promise<WorktreeInfo> {
  const reposDir = getRepositoriesDir();
  const worktreesDir = getWorktreesDir();
  const mainRepoPath = resolve(reposDir, repo.name);

  // Ensure worktrees directory exists
  const repoWorktreesDir = resolve(worktreesDir, repo.name);
  if (!existsSync(repoWorktreesDir)) {
    mkdirSync(repoWorktreesDir, { recursive: true });
  }

  // Check main repo exists
  if (!existsSync(mainRepoPath)) {
    throw new Error(`Main repository not found at ${mainRepoPath}. Run sync first.`);
  }

  const worktreePath = resolve(repoWorktreesDir, branchName.replace(/\//g, "-"));

  // Check if worktree already exists
  if (existsSync(worktreePath)) {
    throw new Error(`Worktree already exists at ${worktreePath}`);
  }

  logger.debug(`Creating worktree for ${repo.name} at ${worktreePath}...`);

  // Refresh remote URL with fresh token before fetching
  await setAuthenticatedRemote(mainRepoPath, repo.url);
  const git = getGitInstance(mainRepoPath);

  // Fetch latest changes first
  try {
    await git.fetch(["--all"]);
  } catch (error) {
    logger.warn(`Failed to fetch latest changes: ${errorMessage(error)}`);
    // Continue anyway with existing local state
  }

  // Check if branch already exists (from a previous failed attempt) and delete it
  try {
    const branches = await git.branchLocal();
    if (branches.all.includes(branchName)) {
      logger.debug(`Branch ${branchName} already exists, deleting it first...`);
      await git.raw(["branch", "-D", branchName]);
    }
  } catch (error) {
    logger.warn(`Failed to check/delete existing branch: ${errorMessage(error)}`);
    // Continue anyway - the worktree add will fail if there's a real issue
  }

  // Get the default branch
  const defaultBranch = repo.branch || "main";

  // Create new branch and worktree from default branch
  await git.raw(["worktree", "add", "-b", branchName, worktreePath, `origin/${defaultBranch}`]);

  // Set authenticated remote in the worktree as well (for push)
  await setAuthenticatedRemote(worktreePath, repo.url);

  logger.debug(`Successfully created worktree at ${worktreePath}`);

  return {
    repoName: repo.name,
    branchName,
    worktreePath,
    createdAt: new Date(),
  };
}

/**
 * Remove a worktree
 */
export async function removeWorktree(repoName: string, worktreePath: string): Promise<void> {
  const mainRepoPath = resolve(getRepositoriesDir(), repoName);

  if (!existsSync(mainRepoPath)) {
    logger.warn(`Main repository not found at ${mainRepoPath}`);
    // Still try to clean up the directory
    if (existsSync(worktreePath)) {
      rmSync(worktreePath, { recursive: true, force: true });
    }
    return;
  }

  logger.debug(`Removing worktree at ${worktreePath}...`);

  const git = getGitInstance(mainRepoPath);

  // `git worktree remove` refuses to delete a directory that contains untracked
  // / gitignored files (e.g. node_modules, build outputs), even with --force.
  // Remove the directory ourselves first, then prune to update git's metadata.
  if (existsSync(worktreePath)) {
    rmSync(worktreePath, { recursive: true, force: true });
  }

  try {
    await git.raw(["worktree", "prune"]);
  } catch (error) {
    logger.warn(`git worktree prune failed: ${errorMessage(error)}`);
  }

  logger.debug(`Successfully removed worktree at ${worktreePath}`);
}

/**
 * Delete a branch from the repository
 */
export async function deleteBranch(
  repoName: string,
  branchName: string,
  deleteRemote: boolean = false,
): Promise<void> {
  const mainRepoPath = resolve(getRepositoriesDir(), repoName);

  if (!existsSync(mainRepoPath)) {
    logger.warn(`Main repository not found at ${mainRepoPath}`);
    return;
  }

  const git = getGitInstance(mainRepoPath);

  try {
    // Delete local branch
    await git.raw(["branch", "-D", branchName]);
    logger.debug(`Deleted local branch ${branchName}`);
  } catch (error) {
    logger.warn(`Failed to delete local branch ${branchName}: ${errorMessage(error)}`);
  }

  if (deleteRemote) {
    // Refresh remote URL with fresh token before pushing
    const repo = findRepoConfig(repoName);
    if (repo) {
      await setAuthenticatedRemote(mainRepoPath, repo.url);
    }
    try {
      await git.raw(["push", "origin", "--delete", branchName]);
      logger.debug(`Deleted remote branch ${branchName}`);
    } catch (error) {
      logger.warn(`Failed to delete remote branch ${branchName}: ${errorMessage(error)}`);
    }
  }
}

/**
 * Cleanup stale worktrees older than retention period
 */
export async function cleanupStaleWorktrees(retentionHours: number = 24): Promise<void> {
  const worktreesDir = getWorktreesDir();

  if (!existsSync(worktreesDir)) {
    return;
  }

  const now = Date.now();
  const retentionMs = retentionHours * 60 * 60 * 1000;

  // In reusable mode the pool owns `worker-N` folder lifecycle (idle release +
  // quarantine). The mtime-based sweep must never delete them — a folder's
  // top-level mtime is not reliably bumped by git operations in subdirs, so an
  // active worker can look "stale" and get reaped out from under the in-memory
  // pool, breaking the next acquire. Non-pool folders are still swept.
  const reusableEnabled = getConfig().changesWorkflow?.reusableFolders?.enabled ?? false;
  const isPoolFolder = (name: string): boolean => /^worker-\d+$/.test(name);

  logger.debug(`Cleaning up worktrees older than ${retentionHours} hours...`);

  const repoNames = readdirSync(worktreesDir).filter((name) => {
    const path = join(worktreesDir, name);
    return statSync(path).isDirectory();
  });

  for (const repoName of repoNames) {
    const repoWorktreesDir = join(worktreesDir, repoName);
    const worktrees = readdirSync(repoWorktreesDir).filter((name) => {
      const path = join(repoWorktreesDir, name);
      return statSync(path).isDirectory();
    });

    for (const worktreeName of worktrees) {
      if (reusableEnabled && isPoolFolder(worktreeName)) {
        continue;
      }
      const worktreePath = join(repoWorktreesDir, worktreeName);
      try {
        const stats = statSync(worktreePath);
        const age = now - stats.mtimeMs;

        if (age > retentionMs) {
          logger.debug(
            `Removing stale worktree: ${worktreePath} (age: ${Math.round(age / 3600000)}h)`,
          );
          await removeWorktree(repoName, worktreePath);
        }
      } catch (error) {
        logger.error(`Failed to check/remove worktree ${worktreePath}:`, error);
      }
    }
  }

  // Prune orphaned worktree references for all repos
  const config = getConfig();
  for (const repo of config.repositories) {
    const mainRepoPath = resolve(getRepositoriesDir(), repo.name);
    if (existsSync(mainRepoPath)) {
      const git = getGitInstance(mainRepoPath);
      try {
        await git.raw(["worktree", "prune"]);
      } catch (error) {
        logger.warn(`Failed to prune worktrees for ${repo.name}:`, error);
      }
    }
  }

  logger.debug("Worktree cleanup complete");
}

/**
 * Ensure worktree and session directories exist (fast, synchronous).
 * Call early in startup before restoring sessions.
 */
export function ensureWorktreeDirectories(): void {
  const worktreesDir = getWorktreesDir();
  const sessionsDir = getWorktreeSessionsDir();

  if (!existsSync(worktreesDir)) {
    mkdirSync(worktreesDir, { recursive: true });
  }

  if (!existsSync(sessionsDir)) {
    mkdirSync(sessionsDir, { recursive: true });
  }
}

/**
 * Clean up stale worktrees and session folders.
 * Safe to run in the background after sessions have been restored
 * (so getActiveChangeBranches() correctly protects restored sessions).
 */
export async function cleanupWorktrees(
  cleanupSessions?: (expiryHours: number) => Promise<void>,
): Promise<void> {
  const config = getConfig();
  const expiryHours = config.changesWorkflow?.sessionExpiryHours ?? 24;
  await cleanupStaleWorktrees(expiryHours);
  await cleanupSessions?.(expiryHours);
}
