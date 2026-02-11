import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { logger } from "./logger.js";

const MCP_CONFIG_PATH = join(process.cwd(), "data", "mcp.json");

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

// Cache the loaded config
let cachedMcpServers: Record<string, McpServerConfig> | undefined;
let configLoaded = false;

/**
 * Loads MCP server configurations from data/mcp.json
 * Supports stdio, sse, and http transport types.
 * Supports environment variable substitution using ${VAR_NAME} syntax
 * in env values (stdio) and header values (sse/http).
 * Caches the result so config is only loaded once.
 */
export function loadMcpServers(): Record<string, McpServerConfig> | undefined {
  // Return cached config if already loaded
  if (configLoaded) {
    return cachedMcpServers;
  }

  configLoaded = true;

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

    cachedMcpServers = result;
    logger.debug(`Loaded MCP config: ${Object.keys(result).join(", ")}`);
    return result;
  } catch (error) {
    logger.error("Failed to load MCP configuration:", error);
    return undefined;
  }
}

/**
 * Returns the names of configured MCP servers (without loading/connecting)
 */
export function getConfiguredMcpServerNames(): string[] {
  const servers = loadMcpServers();
  return servers ? Object.keys(servers) : [];
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
