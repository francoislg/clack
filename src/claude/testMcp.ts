import type { McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import { clackQuery as _clackQuery } from "./query.js";
import { getConfig as _getConfig } from "../config.js";
import { errorMessage as _errorMessage } from "../errors.js";
import {
  loadMcpServers as _loadMcpServers,
  getConfiguredMcpServerNames as _getConfiguredMcpServerNames,
} from "../mcp.js";
import type { SessionContext } from "../sessions.js";
import { buildQueryContext as _buildQueryContext } from "../tools/context.js";
import { buildClackTools as _buildClackTools } from "../tools/server.js";
import type { QueryToolContext, ClackQueryToolsResult } from "../tools/types.js";
import { detectRuntime } from "./utilities.js";

// ---------------------------------------------------------------------------
// Dependency injection
// ---------------------------------------------------------------------------

export interface TestMcpDeps {
  clackQuery: typeof _clackQuery;
  getConfig: typeof _getConfig;
  errorMessage: typeof _errorMessage;
  loadMcpServers: typeof _loadMcpServers;
  getConfiguredMcpServerNames: typeof _getConfiguredMcpServerNames;
  buildQueryContext: typeof _buildQueryContext;
  // testMCP only uses query mode; narrow the signature so test mocks can supply the query shape.
  buildClackTools: (ctx: QueryToolContext) => ClackQueryToolsResult;
}

export const defaultTestMcpDeps: TestMcpDeps = {
  clackQuery: _clackQuery,
  getConfig: _getConfig,
  errorMessage: _errorMessage,
  loadMcpServers: _loadMcpServers,
  getConfiguredMcpServerNames: _getConfiguredMcpServerNames,
  buildQueryContext: _buildQueryContext,
  buildClackTools: _buildClackTools,
};

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
export async function testMCP(deps: TestMcpDeps = defaultTestMcpDeps): Promise<McpTestResult> {
  const config = deps.getConfig();
  const externalMcpServers = await deps.loadMcpServers();
  const configuredServers = deps.getConfiguredMcpServerNames();

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
  let clackMcpServers: Record<string, McpSdkServerConfigWithInstance> = {};
  try {
    const toolCtx = deps.buildQueryContext({
      userId: "test",
      role: "owner",
      session: dummySession,
      config,
      changesWorkflowEnabled: true,
      allowScheduledMessages: config.allowScheduledMessages ?? false,
    });
    const clackTools = deps.buildClackTools(toolCtx);
    clackToolNames = clackTools.toolNames;
    clackMcpServers = clackTools.mcpServers;
  } catch (error) {
    return {
      success: false,
      configuredServers,
      connectedServers: [],
      failedServers: [],
      tools: [],
      mcpTools: [],
      clackTools: [],
      error: `Clack tool server failed to build: ${deps.errorMessage(error)}`,
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

  // Merge clack + per-plugin tool servers with external MCP servers for the test query
  const mcpServers = {
    ...externalMcpServers,
    ...clackMcpServers,
  };

  try {
    let tools: string[] = [];
    let mcpServerStatus: McpServerInfo[] = [];

    // Start a minimal query just to get the init message
    for await (const message of deps.clackQuery({
      prompt: "test",
      options: {
        cwd: process.cwd(),
        executable: detectRuntime(),
        model: "haiku", // Use cheapest model for test
        permissionMode: "bypassPermissions",
        mcpServers: mcpServers as Record<
          string,
          import("@anthropic-ai/claude-agent-sdk").McpServerConfig
        >,
        abortController,
        maxTurns: 1,
      },
    })) {
      // Capture the init message which contains tools and MCP status
      if (message.type === "system" && message.subtype === "init") {
        tools = message.tools || [];
        mcpServerStatus = (message.mcp_servers || []).map(
          (s: { name: string; status: string }) => ({
            name: s.name,
            status: s.status,
          }),
        );
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
      error: deps.errorMessage(error),
    };
  }
}
