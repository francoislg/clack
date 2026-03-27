import { query } from "@anthropic-ai/claude-agent-sdk";
import { getConfig } from "../config.js";
import { errorMessage } from "../errors.js";
import { loadMcpServers, getConfiguredMcpServerNames } from "../mcp.js";
import type { SessionContext } from "../sessions.js";
import { buildQueryContext } from "../tools/context.js";
import { buildClackTools } from "../tools/server.js";
import { detectRuntime } from "./utilities.js";

export interface McpServerInfo {
  name: string;
  status: string;
}

export interface McpTestResult {
  success: boolean;
  configuredServers: string[];
  connectedServers: McpServerInfo[];
  failedServers: McpServerInfo[];
  tools: string[];
  mcpTools: string[];
  clackTools: string[];
  error?: string;
}

/**
 * Tests MCP server connections and returns available tools.
 * Starts a minimal Claude query to get the init message with MCP status.
 * Also verifies that clack (in-process) tools build successfully.
 */
export async function testMCP(): Promise<McpTestResult> {
  const config = getConfig();
  const externalMcpServers = await loadMcpServers();
  const configuredServers = getConfiguredMcpServerNames();

  // Build clack tool server with owner role to verify all tools register
  const dummySession: SessionContext = {
    sessionId: "test",
    channelId: "test",
    messageTs: "test",
    threadTs: "test",
    userId: "test",
    originalQuestion: "test",
    threadContext: [],
    refinements: [],
    errors: [],
    lastActivity: Date.now(),
    createdAt: Date.now(),
  };

  let clackToolNames: string[] = [];
  let clackMcpServer: unknown;
  try {
    const toolCtx = buildQueryContext({
      userId: "test",
      role: "owner",
      session: dummySession,
      config,
      changesWorkflowEnabled: true,
      allowScheduledMessages: config.allowScheduledMessages ?? false,
    });
    const clackTools = buildClackTools(toolCtx);
    clackToolNames = clackTools.toolNames;
    clackMcpServer = clackTools.mcpServer;
  } catch (error) {
    return {
      success: false,
      configuredServers,
      connectedServers: [],
      failedServers: [],
      tools: [],
      mcpTools: [],
      clackTools: [],
      error: `Clack tool server failed to build: ${errorMessage(error)}`,
    };
  }

  if (!externalMcpServers || configuredServers.length === 0) {
    return {
      success: true,
      configuredServers: [],
      connectedServers: [],
      failedServers: [],
      tools: clackToolNames,
      mcpTools: [],
      clackTools: clackToolNames,
    };
  }

  const abortController = new AbortController();

  // Merge clack tools with external MCP servers for the test query
  const mcpServers = {
    ...externalMcpServers,
    clack: clackMcpServer,
  } as Record<string, unknown>;

  try {
    let tools: string[] = [];
    let mcpServerStatus: McpServerInfo[] = [];

    // Start a minimal query just to get the init message
    for await (const message of query({
      prompt: "test",
      options: {
        cwd: process.cwd(),
        executable: detectRuntime(),
        model: "haiku", // Use cheapest model for test
        permissionMode: "bypassPermissions",
        mcpServers: mcpServers as Record<string, import("@anthropic-ai/claude-agent-sdk").McpServerConfig>,
        abortController,
        maxTurns: 1,
      },
    })) {
      // Capture the init message which contains tools and MCP status
      if (message.type === "system" && message.subtype === "init") {
        tools = message.tools || [];
        mcpServerStatus = (message.mcp_servers || []).map((s: { name: string; status: string }) => ({
          name: s.name,
          status: s.status,
        }));
        // Abort after getting init info - we don't need the actual response
        abortController.abort();
        break;
      }
    }

    // Separate connected and failed servers
    const connectedServers = mcpServerStatus.filter((s) => s.status === "connected");
    const failedServers = mcpServerStatus.filter((s) => s.status !== "connected");

    // Filter MCP tools (they start with "mcp__")
    const mcpTools = tools.filter((t) => t.startsWith("mcp__") && !t.startsWith("mcp__clack__"));
    const clackTools = tools.filter((t) => t.startsWith("mcp__clack__"));

    return {
      success: true,
      configuredServers,
      connectedServers,
      failedServers,
      tools,
      mcpTools,
      clackTools,
    };
  } catch (error) {
    // AbortError is expected - we abort after getting init
    if (error instanceof Error && error.name === "AbortError") {
      return {
        success: true,
        configuredServers,
        connectedServers: [],
        failedServers: [],
        tools: [],
        mcpTools: [],
        clackTools: clackToolNames,
      };
    }

    return {
      success: false,
      configuredServers,
      connectedServers: [],
      failedServers: [],
      tools: [],
      mcpTools: [],
      clackTools: clackToolNames,
      error: errorMessage(error),
    };
  }
}
