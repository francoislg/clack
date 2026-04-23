import { config as dotenvConfig } from "dotenv";
import { join } from "path";
import { testMCP } from "./claude/testMcp.js";
import { loadConfig, getConfig } from "./config.js";
import { loadGitHubCredentials, validateGitHubApp } from "./github.js";
import { logger } from "./logger.js";
import { initializeRepositories, syncAllRepositories } from "./repositories.js";
import { createSlackApp, startSlackApp, stopSlackApp } from "./slack/app.js";
import { ensureWorktreeDirectories, cleanupWorktrees } from "./worktrees.js";
import { discoverSkillPluginInfo } from "./skillPlugins.js";
import { loadPlugins } from "./plugins/registry.js";
import { setLoadedPlugins } from "./plugins/state.js";
import { restoreWorkerSessions } from "./changes/restore.js";
import { cleanupStaleSessionFolders } from "./changes/persistence.js";
import { getActiveChangeBranches } from "./changes/activeState.js";
import { validateInstructionFiles } from "./instructions.js";
import { runBlockingMigrations, runEnhancementMigrations } from "./migrations/boot.js";
import { startAll, stopAll } from "./lifecycle.js";
import { setFailedMcpServers } from "./mcpStatus.js";
import { diagnoseMcpServer, type DiagnosableConfig } from "./mcpDiagnose.js";
import { loadMcpServers, resolveEffectiveRegistry } from "./mcp.js";
import { runBaselineSmoke } from "./startupBaselineSmoke.js";

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
  logger.info("Validating GitHub credentials...");
  try {
    loadGitHubCredentials();
    await validateGitHubApp();
  } catch (error) {
    logger.error("Failed to validate GitHub App credentials:", error);
    process.exit(1);
  }

  // Step 1.7: Validate instruction files
  try {
    validateInstructionFiles();
  } catch (error) {
    logger.error("Instruction file validation failed:", error);
    process.exit(1);
  }

  // Step 1.8: Load Clack plugins
  const pluginNames = getConfig().plugins;
  if (pluginNames && pluginNames.length > 0) {
    const loaded = await loadPlugins(pluginNames);
    setLoadedPlugins(loaded);
  }

  // Step 2: Test MCP connections and clack tools
  logger.info("Connecting to MCP servers...");
  try {
    const mcpResult = await testMCP();
    if (mcpResult.clackTools.length > 0) {
      logger.info(`Clack tools registered: ${mcpResult.clackTools.join(", ")}`);
    }
    if (mcpResult.configuredServers.length > 0) {
      if (mcpResult.connectedServers.length > 0) {
        const { registry } = resolveEffectiveRegistry({
          configRegistry: getConfig().mcpServers,
          mcpServerNames: mcpResult.configuredServers,
          githubAutoInjected: mcpResult.configuredServers.includes("github"),
        });
        const alwaysOn: string[] = [];
        const lazy: string[] = [];
        for (const { name } of mcpResult.connectedServers) {
          // Unknown → default to always (parity with homeTab classification).
          if (registry[name]?.alwaysLoad !== false) alwaysOn.push(name);
          else lazy.push(name);
        }
        if (alwaysOn.length > 0) {
          logger.info(`MCP servers always-on: ${alwaysOn.join(", ")}`);
        }
        if (lazy.length > 0) {
          logger.info(`MCP servers lazy (attach on demand): ${lazy.join(", ")}`);
        }
        logger.info(`MCP tools discovered: ${mcpResult.mcpTools.length}`);
      }
      if (mcpResult.failedServers.length > 0) {
        const configs = (await loadMcpServers()) ?? {};
        for (const server of mcpResult.failedServers) {
          const cfg = configs[server.name] as DiagnosableConfig | undefined;
          const detail = cfg ? await diagnoseMcpServer(cfg) : "no config found";
          logger.warn(`MCP server failed: ${server.name} (${server.status}) — ${detail}`);
        }
      }
      setFailedMcpServers(mcpResult.failedServers.map((s) => s.name));
    }
    if (!mcpResult.success) {
      logger.warn(`MCP test issue: ${mcpResult.error}`);
    }
  } catch (error) {
    logger.warn("Failed to test MCP connections:", error);
    // Continue anyway - MCP is optional
  }

  // Step 2.5: Discover plugins — split eager (always passed via --plugin-dir) vs
  // lazy (excluded from baseline; loaded on demand via list_skill_pack_skills /
  // load_skill). Mirrors the MCP always-on / lazy log shape.
  const plugins = discoverSkillPluginInfo();
  if (plugins.length > 0) {
    const fmt = (p: (typeof plugins)[number]) => `${p.name} (${p.skillCount} skills)`;
    const eager = plugins
      .filter((p) => !p.lazyLoad)
      .map(fmt)
      .join(", ");
    const lazy = plugins
      .filter((p) => p.lazyLoad)
      .map(fmt)
      .join(", ");
    if (eager) logger.info(`Skill plugins always-on: ${eager}`);
    if (lazy) logger.info(`Skill plugins lazy (load on demand): ${lazy}`);
  }

  // Step 3: Initialize and sync repositories
  logger.info("Initializing repositories...");
  try {
    await initializeRepositories();
    await syncAllRepositories();
  } catch (error) {
    logger.error("Failed to initialize repositories:", error);
    // Continue anyway - some repos might work
  }

  // Step 3.5: Initialize worktrees and restore sessions
  const config = getConfig();
  if (config.changesWorkflow?.enabled) {
    try {
      ensureWorktreeDirectories();
    } catch (error) {
      logger.warn("Failed to ensure worktree directories:", error);
    }

    // Restore persisted worker sessions into memory (before monitor starts)
    try {
      await restoreWorkerSessions();
    } catch (error) {
      logger.warn("Failed to restore worker sessions:", error);
    }
  }

  // Step 3.8: Baseline token smoke test (fire-and-forget).
  // Launches minimal per-role Claude queries and logs `baseline.tokens role=<x> tokens=<n>`
  // so operators can monitor whether the system-prompt baseline is drifting over time.
  void runBaselineSmoke(config).catch((error) => {
    logger.warn("baseline.tokens.failed stage=unexpected error=", error);
  });

  // Step 4: Create and start Slack app
  logger.info("Starting Slack app...");
  try {
    createSlackApp();
    await startSlackApp();
  } catch (error) {
    logger.error("Failed to start Slack app:", error);
    process.exit(1);
  }

  // Step 5: Start all schedulers, watchers, and monitors (after Slack app is ready)
  startAll();

  logger.startup("Clack is ready!");

  // Background: clean up stale worktrees and sessions (non-blocking)
  if (config.changesWorkflow?.enabled) {
    cleanupWorktrees(async (expiryHours) => {
      await cleanupStaleSessionFolders(expiryHours, getActiveChangeBranches());
    }).catch((error) => {
      logger.warn("Worktree cleanup error:", error);
    });
  }

  // Background: run enhancement migrations (non-blocking)
  runEnhancementMigrations().catch((error) => {
    logger.error("Enhancement migration error:", error);
  });

  async function shutdown(signal: string): Promise<void> {
    logger.startup(`Received ${signal}, shutting down gracefully...`);

    stopAll();
    await stopSlackApp();

    logger.startup("Shutdown complete");
    process.exit(0);
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((error) => {
  logger.error("Fatal error:", error);
  process.exit(1);
});
