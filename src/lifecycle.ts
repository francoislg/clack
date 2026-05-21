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
import { installAllPinnedMcpServers } from "./mcpInstaller.js";
import { resetToolMappingCache } from "./streaming/toolMappingLoader.js";
import { clearRolesCache } from "./roles.js";
import { clearPreferencesCache } from "./userPreferences.js";
import { clearAutoRespondCache } from "./autoRespond.js";
import { clearCronJobsCache } from "./cronJobs.js";
import { loadAndInstallPlugins } from "./plugins/registry.js";
import { getLoadedPlugins } from "./plugins/state.js";
import { unregisterByPluginName as unregisterPluginInteractivity } from "./slack/pluginActionRegistry.js";

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
  installAllPinnedMcpServers: typeof installAllPinnedMcpServers;
  resetToolMappingCache: typeof resetToolMappingCache;
  clearRolesCache: typeof clearRolesCache;
  clearPreferencesCache: typeof clearPreferencesCache;
  clearAutoRespondCache: typeof clearAutoRespondCache;
  clearCronJobsCache: typeof clearCronJobsCache;
  loadAndInstallPlugins: typeof loadAndInstallPlugins;
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
  installAllPinnedMcpServers,
  resetToolMappingCache,
  clearRolesCache,
  clearPreferencesCache,
  clearAutoRespondCache,
  clearCronJobsCache,
  loadAndInstallPlugins,
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
    // Pass a callback so the config-file watcher can trigger restartAll() without importing
    // this module (which would create a circular dependency). Guarded by a "reload in flight"
    // check so back-to-back fs.watch events don't pile up restarts.
    stopConfigWatcherFn = deps.startConfigWatcher({
      onConfigJsonChange: () => {
        if (restartInProgress) {
          deps.logger.info("Config.json change detected during in-flight restart — skipping");
          return;
        }
        restartAll(deps).catch((err) => {
          deps.logger.warn(
            `Config-driven restart failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      },
    });
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
 * 4.5. Re-install pinned MCP servers
 * 4.6. Reload Clack plugins (instructions + tools + tool mappings)
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

    // Step 4.5: Re-install pinned MCP servers — populates the spawn-config
    // cache that resetAllCaches just cleared. Without this, pinned entries
    // (package + version in mcp.json) are unreachable until the next full
    // process boot.
    try {
      const { failed } = await deps.installAllPinnedMcpServers();
      if (failed.length > 0) {
        warnings.push(`Pinned MCP install failed for: ${failed.join(", ")}`);
      }
    } catch (error) {
      warnings.push(
        `Pinned MCP install failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Step 4.6: Reload Clack plugins. Plugin state is consumed reactively via
    // getLoadedPlugins() (tool server, instructions resolver, home tab, tool
    // mapping loader), so replacing it here propagates to the next session
    // without touching any other subsystem. Always call setLoadedPlugins —
    // including with an empty result — so removing a plugin from config takes
    // effect on restart.
    //
    // BEFORE reloading, close any FSWatchers the prior generation registered via
    // sdk.watchFile — otherwise both generations would fire on the next change,
    // doubling work and confusing plugin authors.
    const prior = getLoadedPlugins();
    for (const result of prior.results) {
      for (const watcher of result.watchers ?? []) {
        try {
          watcher.close();
        } catch (err) {
          logger.warn(
            `Failed to close plugin watcher for ${result.name}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      // Plugin action/view handlers from the prior generation must be cleared
      // before re-running init — otherwise stale handlers from the old closures
      // would race the freshly-registered ones.
      unregisterPluginInteractivity(result.name);
    }

    try {
      const pluginNames = config.plugins ?? [];
      await deps.loadAndInstallPlugins(pluginNames);
    } catch (error) {
      warnings.push(
        `Plugin reload failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

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
