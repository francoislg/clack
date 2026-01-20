import { config as dotenvConfig } from "dotenv";
import { join } from "path";
import { testMCP } from "./claude.js";
import { loadConfig } from "./config.js";
import { logger } from "./logger.js";
import { initializeRepositories, startSyncScheduler, stopSyncScheduler } from "./repositories.js";
import { startCleanupScheduler, stopCleanupScheduler } from "./sessions.js";
import { createSlackApp, startSlackApp, stopSlackApp } from "./slack/index.js";

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

  // Step 2: Test MCP connections
  logger.debug("Testing MCP connections...");
  try {
    const mcpResult = await testMCP();
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
  } catch (error) {
    logger.warn("Failed to test MCP connections:", error);
    // Continue anyway - MCP is optional
  }

  // Step 3: Initialize repositories
  logger.debug("Initializing repositories...");
  try {
    await initializeRepositories();
  } catch (error) {
    logger.error("Failed to initialize repositories:", error);
    // Continue anyway - some repos might work
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

  logger.startup("Clack is ready!");

  // Graceful shutdown handling
  const shutdown = async (signal: string): Promise<void> => {
    logger.startup(`Received ${signal}, shutting down gracefully...`);

    stopSyncScheduler();
    stopCleanupScheduler();
    await stopSlackApp();

    logger.startup("Shutdown complete");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((error) => {
  logger.error("Fatal error:", error);
  process.exit(1);
});
