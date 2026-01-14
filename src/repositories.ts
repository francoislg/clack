import { simpleGit, SimpleGit, SimpleGitOptions } from "simple-git";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { getConfig, getRepositoriesDir, type RepositoryConfig } from "./config.js";

function getGitInstance(sshKeyPath?: string, baseDir?: string): SimpleGit {
  const options: Partial<SimpleGitOptions> = {};

  if (baseDir) {
    options.baseDir = baseDir;
  }

  if (sshKeyPath) {
    // Expand ~ to home directory
    const expandedPath = sshKeyPath.replace(/^~/, process.env.HOME || "");
    options.config = [`core.sshCommand=ssh -i ${expandedPath} -o StrictHostKeyChecking=no`];
  }

  return simpleGit(options);
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
    console.log(`Repository ${repo.name} already exists at ${repoPath}`);
    return;
  }

  console.log(`Cloning ${repo.name} from ${repo.url}...`);

  const git = getGitInstance(config.git.sshKeyPath);
  const cloneOptions: string[] = [];

  if (config.git.shallowClone) {
    cloneOptions.push("--depth", String(config.git.cloneDepth));
  }

  if (repo.branch) {
    cloneOptions.push("--branch", repo.branch);
  }

  await git.clone(repo.url, repoPath, cloneOptions);
  console.log(`Successfully cloned ${repo.name}`);
}

export async function pullRepository(repo: RepositoryConfig): Promise<void> {
  const config = getConfig();
  const repoPath = resolve(getRepositoriesDir(), repo.name);

  if (!existsSync(repoPath)) {
    console.log(`Repository ${repo.name} not found, cloning instead...`);
    await cloneRepository(repo);
    return;
  }

  console.log(`Pulling latest changes for ${repo.name}...`);

  const repoGit = getGitInstance(config.git.sshKeyPath, repoPath);

  try {
    await repoGit.pull();
    console.log(`Successfully pulled ${repo.name}`);
  } catch (error) {
    console.error(`Failed to pull ${repo.name}:`, error);
    // Continue with existing local copy
  }
}

export async function syncAllRepositories(): Promise<void> {
  const config = getConfig();
  console.log(`Syncing ${config.repositories.length} repositories...`);

  for (const repo of config.repositories) {
    try {
      await pullRepository(repo);
    } catch (error) {
      console.error(`Failed to sync ${repo.name}:`, error);
      // Continue with other repositories
    }
  }

  console.log("Repository sync complete");
}

export async function initializeRepositories(): Promise<void> {
  const config = getConfig();
  const reposDir = getRepositoriesDir();

  // Ensure repositories directory exists
  if (!existsSync(reposDir)) {
    mkdirSync(reposDir, { recursive: true });
  }

  console.log(`Initializing ${config.repositories.length} repositories...`);

  for (const repo of config.repositories) {
    try {
      await cloneRepository(repo);
    } catch (error) {
      console.error(`Failed to clone ${repo.name}:`, error);
      // Continue with other repositories
    }
  }

  console.log("Repository initialization complete");
}

let syncInterval: NodeJS.Timeout | null = null;

export function startSyncScheduler(): void {
  const config = getConfig();
  const intervalMs = config.git.pullIntervalMinutes * 60 * 1000;

  console.log(`Starting repository sync scheduler (every ${config.git.pullIntervalMinutes} minutes)`);

  syncInterval = setInterval(() => {
    syncAllRepositories().catch((error) => {
      console.error("Scheduled sync failed:", error);
    });
  }, intervalMs);
}

export function stopSyncScheduler(): void {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
    console.log("Repository sync scheduler stopped");
  }
}
