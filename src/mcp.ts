import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { getInstallationToken } from "./github.js";
import { logger } from "./logger.js";

const MCP_CONFIG_PATH = join(process.cwd(), "data", "mcp.json");
const GITHUB_AUTH_PATH = join(process.cwd(), "data", "auth", "github.json");

interface McpStdioConfig {
  type?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface McpRemoteConfig {
  type: "sse" | "http";
  url: string;
  headers?: Record<string, string>;
}

type McpServerEntry = McpStdioConfig | McpRemoteConfig;

interface McpConfig {
  mcpServers?: Record<string, McpServerEntry>;
}

/**
 * Maps GitHub App installation token permission keys to github-mcp-server toolset names.
 */
const PERMISSION_TO_TOOLSET: Record<string, string> = {
  pull_requests: "pull_requests",
  issues: "issues",
  contents: "repos",
  actions: "actions",
  security_events: "code_security",
};

// Cache the static MCP config from mcp.json (parsed once)
let cachedStaticServers: Record<string, McpServerConfig> | undefined;
let staticConfigLoaded = false;

// Cache whether the github-mcp-server binary is available
let binaryAvailable: boolean | null = null;

/**
 * Load and cache the static MCP server config from data/mcp.json.
 * This is parsed once and reused.
 */
function loadStaticMcpConfig(): Record<string, McpServerConfig> | undefined {
  if (staticConfigLoaded) {
    return cachedStaticServers;
  }

  staticConfigLoaded = true;

  if (!existsSync(MCP_CONFIG_PATH)) {
    logger.debug("No MCP configuration found at data/mcp.json");
    return undefined;
  }

  try {
    const raw = readFileSync(MCP_CONFIG_PATH, "utf-8");
    const config: McpConfig = JSON.parse(raw);

    if (!config.mcpServers || Object.keys(config.mcpServers).length === 0) {
      logger.debug("MCP config file exists but has no servers configured");
      return undefined;
    }

    const result: Record<string, McpServerConfig> = {};
    for (const [name, server] of Object.entries(config.mcpServers)) {
      if (server.type === "sse" || server.type === "http") {
        result[name] = {
          type: server.type,
          url: server.url,
          headers: substituteEnvVars(server.headers),
        };
      } else {
        // stdio (default)
        const stdioServer = server as McpStdioConfig;
        result[name] = {
          type: "stdio",
          command: stdioServer.command,
          args: stdioServer.args,
          env: substituteEnvVars(stdioServer.env),
        };
      }
    }

    cachedStaticServers = result;
    logger.debug(`Loaded MCP config: ${Object.keys(result).join(", ")}`);
    return result;
  } catch (error) {
    logger.error("Failed to load MCP configuration:", error);
    return undefined;
  }
}

/**
 * Check if the github-mcp-server binary is available on PATH.
 * Result is cached after first check.
 */
function isGitHubMcpServerAvailable(): boolean {
  if (binaryAvailable !== null) {
    return binaryAvailable;
  }

  try {
    execSync("github-mcp-server --help", { stdio: "ignore" });
    binaryAvailable = true;
  } catch {
    binaryAvailable = false;
  }

  return binaryAvailable;
}

/**
 * Convert GitHub App token permissions to a GITHUB_TOOLSETS string.
 */
export function mapPermissionsToToolsets(permissions: Record<string, string>): string {
  const toolsets: string[] = [];
  for (const [permKey, toolset] of Object.entries(PERMISSION_TO_TOOLSET)) {
    if (permKey in permissions) {
      toolsets.push(toolset);
    }
  }
  return toolsets.join(",");
}

/**
 * Loads MCP server configurations from data/mcp.json and optionally
 * auto-injects a GitHub MCP server from GitHub App credentials.
 *
 * Static config from mcp.json is cached. The GitHub MCP entry is rebuilt
 * per call to ensure a fresh token.
 */
export async function loadMcpServers(): Promise<Record<string, McpServerConfig> | undefined> {
  const staticServers = loadStaticMcpConfig();

  // Check if we should auto-inject GitHub MCP
  const hasManualGitHub = staticServers && "github" in staticServers;
  const hasGitHubCredentials = existsSync(GITHUB_AUTH_PATH);

  if (hasManualGitHub || !hasGitHubCredentials) {
    return staticServers;
  }

  // Check if the binary is available
  if (!isGitHubMcpServerAvailable()) {
    logger.warn("github-mcp-server binary not found — skipping GitHub MCP auto-configuration");
    return staticServers;
  }

  // Generate token and derive toolsets
  try {
    const { token, permissions } = await getInstallationToken();
    const toolsets = mapPermissionsToToolsets(permissions);

    if (!toolsets) {
      logger.warn("GitHub App token has no permissions that map to MCP toolsets — skipping GitHub MCP auto-configuration");
      return staticServers;
    }

    const githubMcpEntry: McpServerConfig = {
      type: "stdio",
      command: "github-mcp-server",
      args: ["stdio"],
      env: {
        GITHUB_PERSONAL_ACCESS_TOKEN: token,
        GITHUB_TOOLSETS: toolsets,
      },
    };

    const result = { ...(staticServers ?? {}), github: githubMcpEntry };
    logger.debug(`Auto-configured GitHub MCP server (toolsets: ${toolsets})`);
    return result;
  } catch (error) {
    logger.warn("Failed to auto-configure GitHub MCP server:", error);
    return staticServers;
  }
}

/**
 * Returns the names of configured MCP servers (without loading/connecting).
 * Uses only the cached static config (synchronous).
 */
export function getConfiguredMcpServerNames(): string[] {
  const servers = loadStaticMcpConfig();
  const names = servers ? Object.keys(servers) : [];

  // Include "github" if auto-config conditions are met
  if (!names.includes("github") && existsSync(GITHUB_AUTH_PATH) && isGitHubMcpServerAvailable()) {
    names.push("github");
  }

  return names;
}

/**
 * Substitutes environment variables in config values
 * Supports ${VAR_NAME} syntax
 */
function substituteEnvVars(
  env?: Record<string, string>
): Record<string, string> | undefined {
  if (!env) return undefined;

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    result[key] = value.replace(/\$\{(\w+)\}/g, (_, varName) => {
      const envValue = process.env[varName];
      if (!envValue) {
        logger.warn(`Environment variable ${varName} is not set (used in MCP config)`);
      }
      return envValue ?? "";
    });
  }
  return result;
}
