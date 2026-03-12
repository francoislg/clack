import { simpleGit, SimpleGit, SimpleGitOptions } from "simple-git";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { getConfig, getRepositoriesDir, type RepositoryConfig } from "./config.js";
import { getAuthenticatedCloneUrl } from "./github.js";
import { logger } from "./logger.js";

function getGitInstance(baseDir?: string): SimpleGit {
  const options: Partial<SimpleGitOptions> = {};

  if (baseDir) {
    options.baseDir = baseDir;
  }

  return simpleGit(options);
}

/**
 * Set the remote URL to an authenticated HTTPS URL with a fresh token.
 * Called before fetch/pull/push to ensure the token is current.
 */
export async function setAuthenticatedRemote(repoPath: string, repoUrl: string): Promise<void> {
  const git = getGitInstance(repoPath);
  const authenticatedUrl = await getAuthenticatedCloneUrl(repoUrl);
  await git.remote(["set-url", "origin", authenticatedUrl]);
}

export async function cloneRepository(repo: RepositoryConfig): Promise<void> {
  const config = getConfig();
  const reposDir = getRepositoriesDir();
  const repoPath = resolve(reposDir, repo.name);

  // Ensure repositories directory exists
  if (!existsSync(reposDir)) {
    mkdirSync(reposDir, { recursive: true });
  }

  // Skip if already cloned
  if (existsSync(repoPath)) {
    logger.debug(`Repository ${repo.name} already exists at ${repoPath}`);
    return;
  }

  logger.debug(`Cloning ${repo.name} from ${repo.url}...`);

  const git = getGitInstance();
  const cloneOptions: string[] = [];

  if (config.git.shallowClone) {
    cloneOptions.push("--depth", String(config.git.cloneDepth));
  }

  if (repo.branch) {
    cloneOptions.push("--branch", repo.branch);
  }

  const authenticatedUrl = await getAuthenticatedCloneUrl(repo.url);
  await git.clone(authenticatedUrl, repoPath, cloneOptions);
  logger.debug(`Successfully cloned ${repo.name}`);
}

export async function syncRepository(repo: RepositoryConfig): Promise<void> {
  const repoPath = resolve(getRepositoriesDir(), repo.name);

  if (!existsSync(repoPath)) {
    logger.debug(`Repository ${repo.name} not found, cloning instead...`);
    await cloneRepository(repo);
    return;
  }

  const branch = repo.branch || "main";
  logger.debug(`Syncing ${repo.name} to origin/${branch}...`);

  // Refresh the remote URL with a fresh token before fetching
  await setAuthenticatedRemote(repoPath, repo.url);
  const repoGit = getGitInstance(repoPath);

  try {
    await repoGit.fetch("origin", branch);
    await repoGit.checkout(["-f", branch]);
    await repoGit.reset(["--hard", `origin/${branch}`]);
    logger.debug(`Successfully synced ${repo.name} to origin/${branch}`);
  } catch (error) {
    logger.error(`Failed to sync ${repo.name}:`, error);
    // Continue with existing local copy
  }
}

export async function syncAllRepositories(): Promise<void> {
  const config = getConfig();
  const total = config.repositories.length;
  logger.debug(`Syncing ${total} repositories...`);

  let failed = 0;
  for (const repo of config.repositories) {
    try {
      await syncRepository(repo);
    } catch (error) {
      failed++;
      logger.error(`Failed to sync ${repo.name}:`, error);
      // Continue with other repositories
    }
  }

  if (failed === 0) {
    logger.info(`Successfully synced all ${total} repositories`);
  } else {
    logger.warn(`Synced ${total - failed}/${total} repositories (${failed} failed)`);
  }
}

export async function initializeRepositories(): Promise<void> {
  const config = getConfig();
  const reposDir = getRepositoriesDir();

  // Ensure repositories directory exists
  if (!existsSync(reposDir)) {
    mkdirSync(reposDir, { recursive: true });
  }

  const total = config.repositories.length;
  logger.debug(`Initializing ${total} repositories...`);

  let failed = 0;
  for (const repo of config.repositories) {
    try {
      await cloneRepository(repo);
    } catch (error) {
      failed++;
      logger.error(`Failed to clone ${repo.name}:`, error);
      // Continue with other repositories
    }
  }

  if (failed === 0) {
    logger.info(`Successfully initialized all ${total} repositories`);
  } else {
    logger.warn(`Initialized ${total - failed}/${total} repositories (${failed} failed)`);
  }
}

let syncInterval: NodeJS.Timeout | null = null;

export function startSyncScheduler(): void {
  const config = getConfig();
  const intervalMs = config.git.pullIntervalMinutes * 60 * 1000;

  logger.debug(`Starting repository sync scheduler (every ${config.git.pullIntervalMinutes} minutes)`);

  syncInterval = setInterval(() => {
    syncAllRepositories().catch((error) => {
      logger.error("Scheduled sync failed:", error);
    });
  }, intervalMs);
}

export function stopSyncScheduler(): void {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
    logger.debug("Repository sync scheduler stopped");
  }
}
