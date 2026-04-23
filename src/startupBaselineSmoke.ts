/**
 * Startup baseline token smoke test.
 *
 * Launches a minimal Claude query per role tier at bot boot and logs the initial
 * `cache_creation_input_tokens` for each. Gives continuous visibility into the
 * system-prompt baseline — a regression tripwire for changes that silently
 * re-inflate it (e.g. a new always-on MCP, a large topical file accidentally
 * moved back into the baseline cascade).
 *
 * Mirrors a real cold-start session: attaches the clack MCP, plugin MCPs, and
 * every `alwaysLoad: true` external MCP. Lazy servers (attached via
 * `attach_integration`) are excluded, matching `completeSessionStart` in
 * `mcpServerManager.ts`.
 *
 * Fire-and-forget: failures log a warning but never block startup.
 */

import type { McpServerConfig, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { clackQuery as defaultClackQuery } from "./claude/query.js";
import {
  buildSystemPrompt as defaultBuildSystemPrompt,
  buildPrompt as defaultBuildPrompt,
} from "./claude/promptBuilder.js";
import { detectRuntime } from "./claude/utilities.js";
import {
  getConfiguredMcpServerNames as defaultGetConfiguredMcpServerNames,
  loadAlwaysOnMcpServers as defaultLoadAlwaysOnMcpServers,
  resolveEffectiveRegistry,
} from "./mcp.js";
import { buildQueryContext as defaultBuildQueryContext } from "./tools/context.js";
import { buildClackTools as defaultBuildClackTools } from "./tools/server.js";
import type { QueryToolContext, ClackQueryToolsResult } from "./tools/types.js";
import { logger as defaultLogger } from "./logger.js";
import type { Config } from "./config.js";
import type { UserRole } from "./roles.js";
import type { SessionContext } from "./sessions.js";
import {
  discoverEagerSkillPlugins as defaultDiscoverEagerSkillPlugins,
  discoverSkillPluginInfo as defaultDiscoverSkillPluginInfo,
} from "./skillPlugins.js";
import { prepareSkillsSession as defaultPrepareSkillsSession } from "./claude/skillsManager.js";
import { McpServerManager } from "./claude/mcpServerManager.js";

/**
 * Role tiers measured by the smoke test. The label is what appears in log lines;
 * the `role` value is the internal `UserRole` used to build the cascade chain.
 */
interface RoleTier {
  label: string;
  role: UserRole;
}

const ROLE_TIERS: readonly RoleTier[] = [
  { label: "user", role: "member" },
  { label: "dev", role: "dev" },
  { label: "admin", role: "admin" },
] as const;

/** Default wall-clock ceiling per-role, in ms. Prevents a stuck MCP spawn from stalling boot. */
const DEFAULT_TIMEOUT_MS = 60_000;

export interface BaselineSmokeLogger {
  info(message: string): void;
  warn(message: string): void;
}

export interface BaselineSmokeDeps {
  clackQuery: typeof defaultClackQuery;
  getConfiguredMcpServerNames: typeof defaultGetConfiguredMcpServerNames;
  loadAlwaysOnMcpServers: typeof defaultLoadAlwaysOnMcpServers;
  buildSystemPrompt: typeof defaultBuildSystemPrompt;
  buildPrompt: typeof defaultBuildPrompt;
  buildQueryContext: typeof defaultBuildQueryContext;
  // Narrow to the query-mode overload — the smoke only measures query-mode baselines.
  buildClackTools: (ctx: QueryToolContext) => ClackQueryToolsResult;
  discoverEagerSkillPlugins: typeof defaultDiscoverEagerSkillPlugins;
  discoverSkillPluginInfo: typeof defaultDiscoverSkillPluginInfo;
  prepareSkillsSession: typeof defaultPrepareSkillsSession;
  logger: BaselineSmokeLogger;
}

export const defaultBaselineSmokeDeps: BaselineSmokeDeps = {
  clackQuery: defaultClackQuery,
  getConfiguredMcpServerNames: defaultGetConfiguredMcpServerNames,
  loadAlwaysOnMcpServers: defaultLoadAlwaysOnMcpServers,
  buildSystemPrompt: defaultBuildSystemPrompt,
  buildPrompt: defaultBuildPrompt,
  buildQueryContext: defaultBuildQueryContext,
  buildClackTools: defaultBuildClackTools,
  discoverEagerSkillPlugins: defaultDiscoverEagerSkillPlugins,
  discoverSkillPluginInfo: defaultDiscoverSkillPluginInfo,
  prepareSkillsSession: defaultPrepareSkillsSession,
  logger: defaultLogger,
};

export interface RunBaselineSmokeOptions {
  timeoutMs?: number;
}

/**
 * Run the baseline smoke test. Safe to await or fire-and-forget — never throws.
 *
 * Waits for all role tiers to complete, then emits a single summary line:
 *   `Current tokens usage per role: user: N, dev: N, admin: N`
 *
 * Per-role failures log a `baseline.tokens.failed` warning and show up as `error`
 * in the summary line so the output shape is stable for grepping.
 */
export async function runBaselineSmoke(
  config: Config,
  options: RunBaselineSmokeOptions = {},
  deps: BaselineSmokeDeps = defaultBaselineSmokeDeps,
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let mcpServers;
  let mcpRegistry;
  try {
    const mcpServerNames = deps.getConfiguredMcpServerNames();
    const resolved = resolveEffectiveRegistry({
      configRegistry: config.mcpServers,
      mcpServerNames,
      githubAutoInjected: mcpServerNames.includes("github"),
    });
    mcpRegistry = resolved.registry;
    mcpServers = await deps.loadAlwaysOnMcpServers(mcpRegistry);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.logger.warn(`baseline.tokens.failed stage=load-mcp error=${message}`);
    return;
  }

  const model = config.claudeCode?.model;
  const results: Array<{ label: string; value: string }> = [];

  for (const tier of ROLE_TIERS) {
    try {
      const tokens = await measureRoleBaseline(
        tier,
        { model, mcpServers, mcpRegistry, timeoutMs, config },
        deps,
      );
      results.push({ label: tier.label, value: String(tokens) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      deps.logger.warn(`baseline.tokens.failed role=${tier.label} error=${message}`);
      results.push({ label: tier.label, value: "error" });
    }
  }

  const summary = results.map((r) => `${r.label}: ${r.value}`).join(", ");
  deps.logger.info(`Current tokens usage per role: ${summary}`);
}

interface MeasureOptions {
  model?: string;
  mcpServers: Awaited<ReturnType<typeof defaultLoadAlwaysOnMcpServers>>;
  mcpRegistry: Config["mcpServers"];
  timeoutMs: number;
  config: Config;
}

async function measureRoleBaseline(
  tier: RoleTier,
  options: MeasureOptions,
  deps: BaselineSmokeDeps,
): Promise<number> {
  const systemPrompt = deps.buildSystemPrompt({
    role: tier.role,
    changesWorkflowEnabled: true,
  });

  // Build the same cold-start wiring a real query uses: dummy session, skillsManager
  // (so list_skill_pack_skills / load_skill tool schemas land in baseline), mcpManager
  // (so attach_integration registers), and a user prompt with the AVAILABLE SKILL PACKS
  // + AVAILABLE INTEGRATIONS catalog blocks.
  const dummySession: SessionContext = {
    sessionId: "baseline",
    channelId: "baseline",
    messageTs: "baseline",
    threadTs: "baseline",
    userId: "baseline",
    trigger: {
      type: "mentions",
      userId: "baseline",
      messageTs: "baseline",
      messageText: "ping",
    },
    messages: [],
    threadContext: [],
    errors: [],
    lastActivity: Date.now(),
    createdAt: Date.now(),
  };

  const skillsManager = deps.prepareSkillsSession(
    dummySession,
    deps.discoverSkillPluginInfo(),
    options.config.skillPlugins,
  );
  const mcpManager = new McpServerManager({}, options.mcpRegistry ?? {});

  const toolCtx = deps.buildQueryContext({
    userId: "baseline",
    role: tier.role,
    session: dummySession,
    config: options.config,
    changesWorkflowEnabled: true,
    allowScheduledMessages: options.config.allowScheduledMessages ?? false,
    mcpManager,
    skillsManager,
  });
  const clackTools = deps.buildClackTools(toolCtx);

  const userPrompt = deps.buildPrompt(dummySession, {
    mcpRegistry: options.mcpRegistry,
    skillPluginsRegistry: options.config.skillPlugins,
  });

  // `McpServerConfig` is the SDK's union of stdio/sse/http/sdk-instance variants;
  // both clack/plugin (sdk-instance) and mcp.json externals assign into it cleanly.
  const mergedMcpServers: Record<string, McpServerConfig> = {
    ...clackTools.mcpServers,
    ...options.mcpServers,
  };

  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), options.timeoutMs);

  try {
    const stream = deps.clackQuery({
      prompt: userPrompt,
      options: {
        cwd: process.cwd(),
        executable: detectRuntime(),
        model: options.model,
        systemPrompt,
        permissionMode: "bypassPermissions",
        maxTurns: 1,
        plugins: deps.discoverEagerSkillPlugins(),
        mcpServers: mergedMcpServers,
        abortController,
      },
    });

    for await (const message of stream) {
      const tokens = extractTotalInputTokens(message);
      if (tokens !== undefined) {
        abortController.abort();
        return tokens;
      }
    }
    throw new Error("stream ended before any assistant turn reported a usage object");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sum the three components of a turn's input-token usage:
 *   - `input_tokens`                  — uncached content in this request
 *   - `cache_creation_input_tokens`   — content newly written to the prompt cache
 *   - `cache_read_input_tokens`       — content read from the prompt cache (cache hits)
 *
 * Cache-creation alone is misleading when multiple serial queries share overlap:
 * the second query hits the cache, so its `cache_creation` is only the delta.
 * The sum is the real prompt size, independent of cache warmth.
 */
function extractTotalInputTokens(message: SDKMessage): number | undefined {
  if (message.type !== "assistant") return undefined;
  const usage = message.message?.usage;
  if (!usage) return undefined;
  const direct = typeof usage.input_tokens === "number" ? usage.input_tokens : 0;
  const creation =
    typeof usage.cache_creation_input_tokens === "number" ? usage.cache_creation_input_tokens : 0;
  const read =
    typeof usage.cache_read_input_tokens === "number" ? usage.cache_read_input_tokens : 0;
  const total = direct + creation + read;
  return total > 0 ? total : undefined;
}
