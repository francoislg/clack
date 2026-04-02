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
// State — stop handles for the current generation of schedulers/watchers
// ---------------------------------------------------------------------------

let stopConfigWatcherFn: (() => void) | undefined;
let restartInProgress = false;

// ---------------------------------------------------------------------------
// Cache Resets
// ---------------------------------------------------------------------------

function resetAllCaches(): void {
  resetMcpCache();
  resetToolMappingCache();
  clearRolesCache();
  clearPreferencesCache();
  clearGitHubTokenCache();
  clearAutoRespondCache();
  clearCronJobsCache();
}

// ---------------------------------------------------------------------------
// Scheduler Start/Stop
// ---------------------------------------------------------------------------

function startSchedulers(): void {
  const config = getConfig();

  startSyncScheduler();
  startCleanupScheduler();

  if (config.claudeCode.watchMcpConfig) {
    stopConfigWatcherFn = startConfigWatcher();
  }

  startCompletionMonitor();

  if (config.allowScheduledMessages) {
    const client = getSlackClient();
    if (client) {
      startCronScheduler(client);
    }
  }
}

function stopSchedulers(): void {
  stopConfigWatcherFn?.();
  stopConfigWatcherFn = undefined;
  stopCronScheduler();
  stopCompletionMonitor();
  stopSyncScheduler();
  stopCleanupScheduler();
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
export function startAll(): void {
  startSchedulers();
}

/**
 * Stop all schedulers and watchers during shutdown.
 * Does NOT stop the Bolt app — that is handled separately.
 */
export function stopAll(): void {
  stopSchedulers();
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
export async function restartAll(): Promise<RestartSummary> {
  if (restartInProgress) {
    throw new Error("A restart is already in progress");
  }
  restartInProgress = true;

  try {
    const warnings: string[] = [];

    // Step 1: Reload env vars
    const envPath = join(process.cwd(), "data", "auth", ".env");
    dotenvConfig({ path: envPath, override: true });

    // Step 2: Reload config — abort on failure (no side effects yet)
    loadConfig(undefined, true);
    const config = getConfig();

    // Step 3: Stop all schedulers and watchers
    stopSchedulers();

    // Step 4: Reset all caches
    resetAllCaches();

    // Step 5: Reload GitHub credentials
    try {
      loadGitHubCredentials();
    } catch (error) {
      warnings.push(
        `GitHub credentials reload failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Step 6: Validate instruction files
    try {
      validateInstructionFiles();
    } catch (error) {
      warnings.push(
        `Instruction file validation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Step 7: Initialize and sync repositories
    try {
      await initializeRepositories();
      await syncAllRepositories();
    } catch (error) {
      warnings.push(
        `Repository sync failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Step 8: Ensure worktree directories
    if (config.changesWorkflow?.enabled) {
      try {
        ensureWorktreeDirectories();
      } catch (error) {
        warnings.push(
          `Worktree directory setup failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // Step 9: Restart all schedulers and watchers
    startSchedulers();

    for (const w of warnings) {
      logger.warn(`Restart warning: ${w}`);
    }

    logger.info("Soft restart complete");

    return {
      repoCount: config.repositories.length,
      warnings,
    };
  } finally {
    restartInProgress = false;
  }
}
