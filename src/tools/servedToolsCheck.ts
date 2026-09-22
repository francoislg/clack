import type { McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { App } from "@slack/bolt";
import { McpServerManager } from "../claude/mcpServerManager.js";
import type { Config } from "../config.js";
import { errorMessage } from "../errors.js";
import { t } from "../i18n/t.js";
import { logger } from "../logger.js";
import { getLoadedPluginIntegrations } from "../plugins-core/state.js";
import type { SessionContext } from "../sessions.js";
import { getOwnerUserId, sendOwnerDm, type OwnerNotifierDeps } from "../slack/ownerDm.js";
import { buildQueryContext } from "./context.js";
import { buildClackTools } from "./server.js";

export interface ToolServer {
  name: string;
  server: McpSdkServerConfigWithInstance;
}

export interface UnlistableToolServer {
  name: string;
  error: string;
}

export const defaultServedToolsCheckDeps: OwnerNotifierDeps = { getOwnerUserId, sendOwnerDm };

function checkSession(): SessionContext {
  return {
    sessionId: "served-tools-check",
    channelId: "served-tools-check",
    messageTs: "0",
    threadTs: "0",
    userId: "served-tools-check",
    trigger: { type: "mentions", userId: "served-tools-check", messageTs: "0", messageText: "" },
    messages: [],
    threadContext: [],
    errors: [],
    lastActivity: 0,
    createdAt: 0,
  };
}

/**
 * Every tool server an owner query session can reach under `config`: the ones it starts with
 * (core `clack`, each plugin's default server, autoloaded on-demand servers) plus every
 * on-demand plugin server, which only an `attach_integration` call ever lists.
 */
export function collectToolServers(
  config: Config,
  slackClient: App["client"] | undefined,
): ToolServer[] {
  const mcpManager = new McpServerManager({}, {});
  const built = buildClackTools(
    buildQueryContext({
      userId: "served-tools-check",
      role: "owner",
      session: checkSession(),
      config,
      changesWorkflowEnabled: config.changesWorkflow?.enabled ?? false,
      cronUserSchedules: config.cron?.userSchedules ?? false,
      slackClient,
      mcpManager,
    }),
  );

  const servers = Object.entries(built.mcpServers).map(([name, server]) => ({ name, server }));
  for (const { name } of getLoadedPluginIntegrations()) {
    const server = mcpManager.getIntegrationServer(name);
    if (server?.type !== "sdk" || servers.some((s) => s.server === server)) continue;
    servers.push({ name, server });
  }
  return servers;
}

async function listTools(server: McpSdkServerConfigWithInstance): Promise<void> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.instance.connect(serverTransport);
  const client = new Client({ name: "served-tools-check", version: "1.0.0" });
  await client.connect(clientTransport);
  try {
    await client.listTools();
  } finally {
    await client.close();
  }
}

/**
 * Lists each server through the Agent SDK's own MCP server — the same conversion a session
 * runs. The listing is all-or-nothing: one tool schema the converter can't handle fails it,
 * and Claude then sees no tool on that server at all.
 */
export async function findUnlistableToolServers(
  servers: ToolServer[],
  list: (server: McpSdkServerConfigWithInstance) => Promise<void> = listTools,
): Promise<UnlistableToolServer[]> {
  const failures: UnlistableToolServer[] = [];
  for (const { name, server } of servers) {
    try {
      await list(server);
    } catch (error) {
      failures.push({ name, error: errorMessage(error) });
    }
  }
  return failures;
}

/** Logs each failure and DMs the owner once about all of them. Best-effort — it never throws. */
export async function reportUnlistableToolServers(
  failures: UnlistableToolServer[],
  deps: OwnerNotifierDeps = defaultServedToolsCheckDeps,
): Promise<void> {
  if (failures.length === 0) return;
  for (const { name, error } of failures) {
    logger.error(
      `Tool server "${name}" cannot list its tools — Claude sees none of them: ${error}`,
    );
  }
  try {
    const owner = await deps.getOwnerUserId();
    if (!owner) return;
    const text = [
      t("tools.unlistable.dm_title", { count: failures.length }),
      ...failures.map(({ name, error }) => t("tools.unlistable.dm_entry", { server: name, error })),
      "",
      t("tools.unlistable.dm_footer"),
    ].join("\n");
    await deps.sendOwnerDm(owner, text, { suppressUnfurls: true });
  } catch (error) {
    logger.warn(`served-tools-check: owner DM failed: ${errorMessage(error)}`);
  }
}

/**
 * Boot / soft-restart guard: lists every tool server under the live config and reports the
 * ones that can't list. Warns rather than blocks — one broken plugin tool must not take the
 * bot down. It never throws, and returns the failures for the caller's own summary.
 */
export async function checkServedToolServers(
  config: Config,
  slackClient: App["client"] | undefined,
): Promise<UnlistableToolServer[]> {
  try {
    const failures = await findUnlistableToolServers(collectToolServers(config, slackClient));
    await reportUnlistableToolServers(failures);
    return failures;
  } catch (error) {
    logger.warn(`served-tools-check: failed: ${errorMessage(error)}`);
    return [];
  }
}
