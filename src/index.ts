import { config as dotenvConfig } from "dotenv";
import { join } from "path";
import { testMCP } from "./claude/testMcp.js";
import { loadConfig, getConfig } from "./config.js";
import { loadGitHubCredentials, validateGitHubApp } from "./github.js";
import { logger } from "./logger.js";
import { initializeRepositories, syncAllRepositories, startSyncScheduler, stopSyncScheduler } from "./repositories.js";
import { startCleanupScheduler, stopCleanupScheduler } from "./sessions.js";
import { createSlackApp, startSlackApp, stopSlackApp } from "./slack/app.js";
import { initializeWorktrees } from "./worktrees.js";
import { discoverPluginInfo } from "./plugins.js";
import { startCompletionMonitor, stopCompletionMonitor } from "./changes/monitor.js";
import { restoreWorkerSessions } from "./changes/restore.js";
import { cleanupStaleSessionFolders } from "./changes/persistence.js";
import { getActiveChangeBranches } from "./changes/activeState.js";
import { validateInstructionFiles } from "./instructions.js";
import { runBlockingMigrations, runEnhancementMigrations } from "./migrations/boot.js";

// Load environment variables from .env files (later files don't override earlier ones)
dotenvConfig({ path: join(process.cwd(), ".env") });
dotenvConfig({ path: join(process.cwd(), "data", "auth", ".env") });

async function main(): Promise<void> {
  logger.startup("Starting Clack...");

  // Step 1: Load and validate configuration
  logger.debug("Loading configuration...");
  try {
    loadConfig();
    logger.info("Configuration loaded");
  } catch (error) {
    logger.error("Failed to load configuration:", error);
    process.exit(1);
  }

  // Step 1.5: Run blocking migrations (must complete before boot continues)
  try {
    await runBlockingMigrations();
  } catch (error) {
    logger.error("Blocking migration failed:", error);
    process.exit(1);
  }

  // Step 1.6: Load and validate GitHub App credentials
  logger.debug("Validating GitHub App credentials...");
  try {
    loadGitHubCredentials();
    await validateGitHubApp();
  } catch (error) {
    logger.error("Failed to validate GitHub App credentials:", error);
    process.exit(1);
  }

  // Step 1.6: Validate instruction files
  try {
    validateInstructionFiles();
  } catch (error) {
    logger.error("Instruction file validation failed:", error);
    process.exit(1);
  }

  // Step 2: Test MCP connections and clack tools
  logger.debug("Testing MCP connections...");
  try {
    const mcpResult = await testMCP();
    if (mcpResult.clackTools.length > 0) {
      logger.info(`Clack tools registered: ${mcpResult.clackTools.join(", ")}`);
    }
    if (mcpResult.configuredServers.length > 0) {
      if (mcpResult.connectedServers.length > 0) {
        const serverNames = mcpResult.connectedServers.map((s) => s.name).join(", ");
        logger.info(`MCP servers connected: ${serverNames} (${mcpResult.mcpTools.length} tools)`);
      }
      if (mcpResult.failedServers.length > 0) {
        for (const server of mcpResult.failedServers) {
          logger.warn(`MCP server failed: ${server.name} (${server.status})`);
        }
      }
    }
    if (!mcpResult.success) {
      logger.warn(`MCP test issue: ${mcpResult.error}`);
    }
  } catch (error) {
    logger.warn("Failed to test MCP connections:", error);
    // Continue anyway - MCP is optional
  }

  // Step 2.5: Discover plugins
  const plugins = discoverPluginInfo();
  if (plugins.length > 0) {
    const pluginSummary = plugins.map((p) => `${p.name} (${p.skillCount} skills)`).join(", ");
    logger.info(`Plugins loaded: ${pluginSummary}`);
  }

  // Step 3: Initialize and sync repositories
  logger.debug("Initializing repositories...");
  try {
    await initializeRepositories();
    await syncAllRepositories();
  } catch (error) {
    logger.error("Failed to initialize repositories:", error);
    // Continue anyway - some repos might work
  }

  // Step 3.5: Initialize worktrees (cleanup stale ones)
  const config = getConfig();
  if (config.changesWorkflow?.enabled) {
    logger.debug("Initializing worktrees...");
    try {
      await initializeWorktrees(async (expiryHours) => {
        await cleanupStaleSessionFolders(expiryHours, getActiveChangeBranches());
      });
      logger.info("Worktrees initialized");
    } catch (error) {
      logger.warn("Failed to initialize worktrees:", error);
      // Continue anyway - worktree cleanup is not critical
    }

    // Restore persisted worker sessions into memory (after worktree cleanup, before monitor)
    try {
      restoreWorkerSessions();
    } catch (error) {
      logger.warn("Failed to restore worker sessions:", error);
      // Continue anyway - restoration is not critical
    }
  }

  // Step 4: Start schedulers
  startSyncScheduler();
  startCleanupScheduler();

  // Step 5: Create and start Slack app
  logger.debug("Starting Slack app...");
  try {
    createSlackApp();
    await startSlackApp();
  } catch (error) {
    logger.error("Failed to start Slack app:", error);
    process.exit(1);
  }

  // Step 6: Start completion monitor (after Slack app is ready for notifications)
  startCompletionMonitor();

  logger.startup("Clack is ready!");

  // Step 7: Run enhancement migrations in background (non-blocking)
  runEnhancementMigrations().catch((error) => {
    logger.error("Enhancement migration error:", error);
  });

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

async function shutdown(signal: string): Promise<void> {
  logger.startup(`Received ${signal}, shutting down gracefully...`);

  stopCompletionMonitor();
  stopSyncScheduler();
  stopCleanupScheduler();
  await stopSlackApp();

  logger.startup("Shutdown complete");
  process.exit(0);
}

main().catch((error) => {
  logger.error("Fatal error:", error);
  process.exit(1);
});
