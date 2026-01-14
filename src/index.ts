import { loadConfig } from "./config.js";
import { initializeRepositories, startSyncScheduler, stopSyncScheduler } from "./repositories.js";
import { startCleanupScheduler, stopCleanupScheduler } from "./sessions.js";
import { createSlackApp, startSlackApp, stopSlackApp } from "./slack/index.js";

async function main(): Promise<void> {
  console.log("Starting Clack...");

  // Step 1: Load and validate configuration
  console.log("Loading configuration...");
  try {
    loadConfig();
    console.log("Configuration loaded successfully");
  } catch (error) {
    console.error("Failed to load configuration:", error);
    process.exit(1);
  }

  // Step 2: Initialize repositories
  console.log("Initializing repositories...");
  try {
    await initializeRepositories();
  } catch (error) {
    console.error("Failed to initialize repositories:", error);
    // Continue anyway - some repos might work
  }

  // Step 3: Start schedulers
  startSyncScheduler();
  startCleanupScheduler();

  // Step 4: Create and start Slack app
  console.log("Starting Slack app...");
  try {
    createSlackApp();
    await startSlackApp();
  } catch (error) {
    console.error("Failed to start Slack app:", error);
    process.exit(1);
  }

  console.log("Clack is ready!");

  // Graceful shutdown handling
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\nReceived ${signal}, shutting down gracefully...`);

    stopSyncScheduler();
    stopCleanupScheduler();
    await stopSlackApp();

    console.log("Shutdown complete");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
