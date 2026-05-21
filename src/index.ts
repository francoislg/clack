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
import { loadAndInstallPlugins } from "./plugins/registry.js";
import { restoreWorkerSessions } from "./changes/restore.js";
import { runWorktreeInstall, runWorktreeSetup } from "./changes/execution.js";
import { initializePoolForBoot, provisionMinimumWorkers } from "./workers/index.js";
import { notifyOwnerOfQuarantine } from "./workers/quarantineNotifier.js";
import { cleanupStaleSessionFolders } from "./changes/persistence.js";
import { getActiveChangeBranches } from "./changes/activeState.js";
import { validateInstructionFiles } from "./instructions.js";
import { runBlockingMigrations, runEnhancementMigrations } from "./migrations/boot.js";
import { startAll, stopAll } from "./lifecycle.js";
import { addFailedMcpServers } from "./mcpStatus.js";
import { diagnoseMcpServer, type DiagnosableConfig } from "./mcpDiagnose.js";
import { getPinnedEntries, loadMcpServers, resolveEffectiveRegistry } from "./mcp.js";
import { installAllPinnedMcpServers } from "./mcpInstaller.js";
import { runBaselineSmoke } from "./startupBaselineSmoke.js";

// Load environment variables from .env files (later files don't override earlier ones)
dotenvConfig({ path: join(process.cwd(), ".env") });
dotenvConfig({ path: join(process.cwd(), "data", "auth", ".env") });

// Defer MCP tool schemas via Claude Code's Tool Search. Without this, the full
// tool registry (~150 PostHog tools, ~50 MongoDB tools, etc.) lands in every
// session's system prompt — pushing the floor to ~170K tokens and triggering
// autocompact thrashing. `auto` activates Tool Search only when MCP tools
// exceed 10% of context, so light setups are unaffected. Operator can override
// by setting ENABLE_TOOL_SEARCH explicitly in the environment.
// Requires Sonnet 4+ / Opus 4+; Haiku doesn't support it (used only for
// pre-analysis, where tool registries are small anyway).
if (process.env.ENABLE_TOOL_SEARCH === undefined) {
  process.env.ENABLE_TOOL_SEARCH = "auto";
}
// eslint-disable-next-line no-console
console.log(`[startup] ENABLE_TOOL_SEARCH=${process.env.ENABLE_TOOL_SEARCH}`);

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
    await loadAndInstallPlugins(pluginNames);
  }

  // Step 1.9: Install pinned MCP packages. Each pinned entry in data/mcp.json
  // (with `package` + `version`) is installed into data/mcp_packages/<name>/
  // with hoisting disabled. Validation errors fail boot fast; install errors
  // are surfaced via the failed-MCP set so the Home tab reflects reality.
  try {
    getPinnedEntries(); // surface schema/validation errors before the install loop
  } catch (error) {
    logger.error("Invalid MCP configuration:", error);
    process.exit(1);
  }
  const { failed: pinnedFailures } = await installAllPinnedMcpServers();
  if (pinnedFailures.length > 0) {
    addFailedMcpServers(pinnedFailures);
  }

  // Step 2: Test MCP connections and clack tools
  logger.info("Connecting to MCP servers...");
  let mcpResult: Awaited<ReturnType<typeof testMCP>>;
  try {
    mcpResult = await testMCP();
  } catch (error) {
    // testMCP itself crashed — boot must not continue without verifying
    // that Clack's in-process tools registered.
    logger.error("Failed to test MCP connections — refusing to boot:", error);
    process.exit(1);
  }
  // Hard guard: if the SDK comes back with zero `mcp__clack__*` tools, the
  // in-process tool server failed to register (e.g. a Zod schema that the
  // SDK can't serialize to JSON Schema makes `tools/list` throw and silently
  // strips the whole registry). The bot is useless without `submit_response`
  // so fail loudly here rather than booting into a broken state.
  if (mcpResult.clackTools.length === 0) {
    logger.error(
      "Clack registered ZERO internal tools — the in-process MCP server failed to expose any tool. " +
        "Common cause: a Zod schema in src/tools/** that cannot be serialized to JSON Schema. " +
        `testMCP error: ${mcpResult.error ?? "(none)"}`,
    );
    process.exit(1);
  }
  try {
    logger.info(`Clack tools registered: ${mcpResult.clackTools.join(", ")}`);
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
      addFailedMcpServers(mcpResult.failedServers.map((s) => s.name));
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

    // Reusable worker-pool: inject the setup runner and reconcile in-memory
    // state with disk BEFORE session restore reads pool.findByBranch().
    // No-op in disposable mode.
    try {
      await initializePoolForBoot(config, {
        runSetup: async (repoName, worktreePath, branch) => {
          await runWorktreeSetup(repoName, worktreePath, branch);
        },
        runInstall: async (repoName, worktreePath, branch) => {
          await runWorktreeInstall(repoName, worktreePath, branch);
        },
        onQuarantine: notifyOwnerOfQuarantine,
      });
    } catch (error) {
      logger.warn("Failed to initialize worker pool:", error);
    }

    // Restore persisted worker sessions into memory (before monitor starts)
    try {
      await restoreWorkerSessions();
    } catch (error) {
      logger.warn("Failed to restore worker sessions:", error);
    }

    // Warm-up: provision minimum workers per repo (fire-and-forget).
    // Each worker's setup runs in the background; concurrent acquires await
    // the in-flight `readyPromise` rather than spawning duplicate setup.
    provisionMinimumWorkers(config, config.repositories);
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
