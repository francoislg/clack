import { loadConfig } from "./config.js";
import { logger } from "./logger.js";
import { initializeRepositories, startSyncScheduler, stopSyncScheduler } from "./repositories.js";
import { startCleanupScheduler, stopCleanupScheduler } from "./sessions.js";
import { createSlackApp, startSlackApp, stopSlackApp } from "./slack/index.js";

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

  // Step 2: Initialize repositories
  logger.debug("Initializing repositories...");
  try {
    await initializeRepositories();
  } catch (error) {
    logger.error("Failed to initialize repositories:", error);
    // Continue anyway - some repos might work
  }

  // Step 3: Start schedulers
  startSyncScheduler();
  startCleanupScheduler();

  // Step 4: Create and start Slack app
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
