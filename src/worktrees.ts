import { simpleGit, SimpleGit, SimpleGitOptions } from "simple-git";
import { existsSync, mkdirSync, rmSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { getConfig, getRepositoriesDir, getWorktreesDir, getWorktreeSessionsDir, type RepositoryConfig } from "./config.js";
import { getAuthenticatedCloneUrl } from "./github.js";
import { logger } from "./logger.js";
import { cleanupStaleSessionFolders } from "./changes/persistence.js";
import { getActiveSessions } from "./changes/session.js";

function getGitInstance(baseDir?: string): SimpleGit {
  const options: Partial<SimpleGitOptions> = {};

  if (baseDir) {
    options.baseDir = baseDir;
  }

  return simpleGit(options);
}

/**
 * Set the remote URL to an authenticated HTTPS URL with a fresh token.
 */
async function setAuthenticatedRemote(repoPath: string, repoUrl: string): Promise<void> {
  const git = getGitInstance(repoPath);
  const authenticatedUrl = await getAuthenticatedCloneUrl(repoUrl);
  await git.remote(["set-url", "origin", authenticatedUrl]);
}

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
  branchName: string
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
  branchName: string
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
    logger.warn(`Failed to fetch latest changes: ${error}`);
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
    logger.warn(`Failed to check/delete existing branch: ${error}`);
    // Continue anyway - the worktree add will fail if there's a real issue
  }

  // Get the default branch
  const defaultBranch = repo.branch || "main";

  // Create new branch and worktree from default branch
  await git.raw([
    "worktree",
    "add",
    "-b",
    branchName,
    worktreePath,
    `origin/${defaultBranch}`,
  ]);

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
export async function removeWorktree(
  repoName: string,
  worktreePath: string
): Promise<void> {
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

  try {
    // Force remove the worktree
    await git.raw(["worktree", "remove", "--force", worktreePath]);
  } catch (error) {
    logger.warn(`git worktree remove failed, cleaning up manually: ${error}`);
    // Manually remove the directory
    if (existsSync(worktreePath)) {
      rmSync(worktreePath, { recursive: true, force: true });
    }
    // Prune worktree references
    await git.raw(["worktree", "prune"]);
  }

  logger.debug(`Successfully removed worktree at ${worktreePath}`);
}

/**
 * Delete a branch from the repository
 */
export async function deleteBranch(
  repoName: string,
  branchName: string,
  deleteRemote: boolean = false
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
    logger.warn(`Failed to delete local branch ${branchName}: ${error}`);
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
      logger.warn(`Failed to delete remote branch ${branchName}: ${error}`);
    }
  }
}

/**
 * Get all worktrees for a repository
 */
export async function listWorktrees(repoName: string): Promise<string[]> {
  const worktreesDir = getWorktreesDir();
  const repoWorktreesDir = resolve(worktreesDir, repoName);

  if (!existsSync(repoWorktreesDir)) {
    return [];
  }

  try {
    return readdirSync(repoWorktreesDir)
      .filter((name) => {
        const path = join(repoWorktreesDir, name);
        return statSync(path).isDirectory();
      })
      .map((name) => join(repoWorktreesDir, name));
  } catch (error) {
    logger.error(`Failed to list worktrees for ${repoName}:`, error);
    return [];
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
      const worktreePath = join(repoWorktreesDir, worktreeName);
      try {
        const stats = statSync(worktreePath);
        const age = now - stats.mtimeMs;

        if (age > retentionMs) {
          logger.debug(`Removing stale worktree: ${worktreePath} (age: ${Math.round(age / 3600000)}h)`);
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
 * Initialize worktrees directory on startup
 */
export async function initializeWorktrees(): Promise<void> {
  const worktreesDir = getWorktreesDir();
  const sessionsDir = getWorktreeSessionsDir();

  if (!existsSync(worktreesDir)) {
    mkdirSync(worktreesDir, { recursive: true });
  }

  if (!existsSync(sessionsDir)) {
    mkdirSync(sessionsDir, { recursive: true });
  }

  // Clean up stale worktrees and session folders
  const config = getConfig();
  const expiryHours = config.changesWorkflow?.sessionExpiryHours ?? 24;
  await cleanupStaleWorktrees(expiryHours);
  cleanupStaleSessionFolders(expiryHours, getActiveSessions());
}
