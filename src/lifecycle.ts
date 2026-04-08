import { join } from "path";
import { config as dotenvConfig } from "dotenv";

import { loadConfig, getConfig } from "./config.js";
import { loadGitHubCredentials, clearGitHubTokenCache } from "./github.js";
import { logger } from "./logger.js";
import {
  initializeRepositories,
  syncAllRepositories,
  startSyncScheduler,
  stopSyncScheduler,
} from "./repositories.js";
import { startCleanupScheduler, stopCleanupScheduler } from "./sessions.js";
import { getSlackClient } from "./slack/app.js";
import { ensureWorktreeDirectories } from "./worktrees.js";
import { startCompletionMonitor, stopCompletionMonitor } from "./changes/monitor.js";
import { validateInstructionFiles } from "./instructions.js";
import { startConfigWatcher } from "./configWatcher.js";
import { startCronScheduler, stopCronScheduler } from "./cronScheduler.js";
import { resetMcpCache } from "./mcp.js";
import { resetToolMappingCache } from "./streaming/toolMappingLoader.js";
import { clearRolesCache } from "./roles.js";
import { clearPreferencesCache } from "./userPreferences.js";
import { clearAutoRespondCache } from "./autoRespond.js";
import { clearCronJobsCache } from "./cronJobs.js";

// ---------------------------------------------------------------------------
// Dependency Injection
// ---------------------------------------------------------------------------

export interface LifecycleDeps {
  dotenvConfig: typeof dotenvConfig;
  loadConfig: typeof loadConfig;
  getConfig: typeof getConfig;
  loadGitHubCredentials: typeof loadGitHubCredentials;
  clearGitHubTokenCache: typeof clearGitHubTokenCache;
  logger: typeof logger;
  initializeRepositories: typeof initializeRepositories;
  syncAllRepositories: typeof syncAllRepositories;
  startSyncScheduler: typeof startSyncScheduler;
  stopSyncScheduler: typeof stopSyncScheduler;
  startCleanupScheduler: typeof startCleanupScheduler;
  stopCleanupScheduler: typeof stopCleanupScheduler;
  getSlackClient: typeof getSlackClient;
  ensureWorktreeDirectories: typeof ensureWorktreeDirectories;
  startCompletionMonitor: typeof startCompletionMonitor;
  stopCompletionMonitor: typeof stopCompletionMonitor;
  validateInstructionFiles: typeof validateInstructionFiles;
  startConfigWatcher: typeof startConfigWatcher;
  startCronScheduler: typeof startCronScheduler;
  stopCronScheduler: typeof stopCronScheduler;
  resetMcpCache: typeof resetMcpCache;
  resetToolMappingCache: typeof resetToolMappingCache;
  clearRolesCache: typeof clearRolesCache;
  clearPreferencesCache: typeof clearPreferencesCache;
  clearAutoRespondCache: typeof clearAutoRespondCache;
  clearCronJobsCache: typeof clearCronJobsCache;
}

export const defaultLifecycleDeps: LifecycleDeps = {
  dotenvConfig,
  loadConfig,
  getConfig,
  loadGitHubCredentials,
  clearGitHubTokenCache,
  logger,
  initializeRepositories,
  syncAllRepositories,
  startSyncScheduler,
  stopSyncScheduler,
  startCleanupScheduler,
  stopCleanupScheduler,
  getSlackClient,
  ensureWorktreeDirectories,
  startCompletionMonitor,
  stopCompletionMonitor,
  validateInstructionFiles,
  startConfigWatcher,
  startCronScheduler,
  stopCronScheduler,
  resetMcpCache,
  resetToolMappingCache,
  clearRolesCache,
  clearPreferencesCache,
  clearAutoRespondCache,
  clearCronJobsCache,
};

// ---------------------------------------------------------------------------
// State — stop handles for the current generation of schedulers/watchers
// ---------------------------------------------------------------------------

let stopConfigWatcherFn: (() => void) | undefined;
let restartInProgress = false;

// ---------------------------------------------------------------------------
// Cache Resets
// ---------------------------------------------------------------------------

function resetAllCaches(deps: LifecycleDeps = defaultLifecycleDeps): void {
  deps.resetMcpCache();
  deps.resetToolMappingCache();
  deps.clearRolesCache();
  deps.clearPreferencesCache();
  deps.clearGitHubTokenCache();
  deps.clearAutoRespondCache();
  deps.clearCronJobsCache();
}

// ---------------------------------------------------------------------------
// Scheduler Start/Stop
// ---------------------------------------------------------------------------

function startSchedulers(deps: LifecycleDeps = defaultLifecycleDeps): void {
  const config = deps.getConfig();

  deps.startSyncScheduler();
  deps.startCleanupScheduler();

  if (config.claudeCode.watchMcpConfig) {
    stopConfigWatcherFn = deps.startConfigWatcher();
  }

  deps.startCompletionMonitor();

  if (config.allowScheduledMessages) {
    const client = deps.getSlackClient();
    if (client) {
      deps.startCronScheduler(client);
    }
  }
}

function stopSchedulers(deps: LifecycleDeps = defaultLifecycleDeps): void {
  stopConfigWatcherFn?.();
  stopConfigWatcherFn = undefined;
  deps.stopCronScheduler();
  deps.stopCompletionMonitor();
  deps.stopSyncScheduler();
  deps.stopCleanupScheduler();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RestartSummary {
  repoCount: number;
  warnings: string[];
}

/**
 * Start all schedulers and watchers after the Bolt app is running.
 * Called once from index.ts during boot.
 */
export function startAll(deps: LifecycleDeps = defaultLifecycleDeps): void {
  startSchedulers(deps);
}

/**
 * Stop all schedulers and watchers during shutdown.
 * Does NOT stop the Bolt app — that is handled separately.
 */
export function stopAll(deps: LifecycleDeps = defaultLifecycleDeps): void {
  stopSchedulers(deps);
}

/**
 * Soft restart: reload config, reset caches, restart schedulers.
 * The Bolt App socket stays connected throughout.
 *
 * Sequence:
 * 1. Reload env vars (dotenv with override)
 * 2. Reload config — if this fails, abort without side effects
 * 3. Stop all schedulers and watchers
 * 4. Reset all module caches
 * 5. Reload GitHub credentials
 * 6. Validate instruction files
 * 7. Initialize + sync repositories
 * 8. Ensure worktree directories
 * 9. Restart all schedulers and watchers
 */
export async function restartAll(
  deps: LifecycleDeps = defaultLifecycleDeps,
): Promise<RestartSummary> {
  if (restartInProgress) {
    throw new Error("A restart is already in progress");
  }
  restartInProgress = true;

  try {
    const warnings: string[] = [];

    // Step 1: Reload env vars
    const envPath = join(process.cwd(), "data", "auth", ".env");
    deps.dotenvConfig({ path: envPath, override: true });

    // Step 2: Reload config — abort on failure (no side effects yet)
    deps.loadConfig(undefined, true);
    const config = deps.getConfig();

    // Step 3: Stop all schedulers and watchers
    stopSchedulers(deps);

    // Step 4: Reset all caches
    resetAllCaches(deps);

    // Step 5: Reload GitHub credentials
    try {
      deps.loadGitHubCredentials();
    } catch (error) {
      warnings.push(
        `GitHub credentials reload failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Step 6: Validate instruction files
    try {
      deps.validateInstructionFiles();
    } catch (error) {
      warnings.push(
        `Instruction file validation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Step 7: Initialize and sync repositories
    try {
      await deps.initializeRepositories();
      await deps.syncAllRepositories();
    } catch (error) {
      warnings.push(
        `Repository sync failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Step 8: Ensure worktree directories
    if (config.changesWorkflow?.enabled) {
      try {
        deps.ensureWorktreeDirectories();
      } catch (error) {
        warnings.push(
          `Worktree directory setup failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // Step 9: Restart all schedulers and watchers
    startSchedulers(deps);

    for (const w of warnings) {
      deps.logger.warn(`Restart warning: ${w}`);
    }

    deps.logger.info("Soft restart complete");

    return {
      repoCount: config.repositories.length,
      warnings,
    };
  } finally {
    restartInProgress = false;
  }
}
