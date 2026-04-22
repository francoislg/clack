import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { getInstallationToken } from "./github.js";
import { logger } from "./logger.js";
import type { McpServerRegistry } from "./config.js";

// ============================================================================
// Dependency Injection
// ============================================================================

interface ExecSyncOptions {
  stdio?: string | NodeJS.WriteStream[];
}

export interface McpDeps {
  existsSync: (path: string) => boolean;
  readFileSync: (path: string, options: BufferEncoding) => string;
  execSync: (cmd: string, opts: ExecSyncOptions) => Buffer;
  getInstallationToken: () => Promise<{
    token: string;
    permissions: Record<string, string>;
    expiresAt: Date;
  }>;
}

export const defaultMcpDeps: McpDeps = {
  existsSync,
  readFileSync,
  execSync,
  getInstallationToken,
};

function getMcpConfigPath(): string {
  return join(process.cwd(), "data", "mcp.json");
}

function getGitHubAuthPath(): string {
  return join(process.cwd(), "data", "auth", "github.json");
}

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
 * One permission may enable multiple toolsets.
 */
const PERMISSION_TO_TOOLSETS: Record<string, string[]> = {
  pull_requests: ["pull_requests", "issues"],
  issues: ["issues", "labels"],
  contents: ["repos", "git"],
  actions: ["actions"],
  security_events: ["code_security", "security_advisories"],
  secret_scanning_alerts: ["secret_protection"],
  vulnerability_alerts: ["dependabot"],
  repository_projects: ["projects"],
  organization_projects: ["projects"],
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
function loadStaticMcpConfig(
  deps: McpDeps = defaultMcpDeps,
): Record<string, McpServerConfig> | undefined {
  if (staticConfigLoaded) {
    return cachedStaticServers;
  }

  staticConfigLoaded = true;

  if (!deps.existsSync(getMcpConfigPath())) {
    logger.debug("No MCP configuration found at data/mcp.json");
    return undefined;
  }

  try {
    const raw = deps.readFileSync(getMcpConfigPath(), "utf-8");
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
function isGitHubMcpServerAvailable(deps: McpDeps = defaultMcpDeps): boolean {
  if (binaryAvailable !== null) {
    return binaryAvailable;
  }

  try {
    // Use 'where' on Windows, 'which' elsewhere — just checks PATH presence
    // without executing the binary (whose --help may exit non-zero).
    const cmd =
      process.platform === "win32" ? "where github-mcp-server" : "which github-mcp-server";
    deps.execSync(cmd, { stdio: "ignore" });
    binaryAvailable = true;
  } catch {
    binaryAvailable = false;
  }

  return binaryAvailable;
}

/**
 * Convert GitHub App token permissions to a GITHUB_TOOLSETS string.
 * Always includes the "context" toolset (no permission required).
 */
export function mapPermissionsToToolsets(permissions: Record<string, string>): string {
  const toolsets = new Set<string>(["context"]);
  for (const [permKey, toolsetList] of Object.entries(PERMISSION_TO_TOOLSETS)) {
    if (permKey in permissions) {
      for (const ts of toolsetList) {
        toolsets.add(ts);
      }
    }
  }
  return [...toolsets].join(",");
}

/**
 * Build a fresh GitHub MCP server entry via GitHub App credentials. Returns undefined
 * when auto-injection conditions aren't met (no credentials, missing binary, no useful
 * permissions, or token fetch failed). Always mints a fresh token on each call.
 */
async function buildGithubMcpEntry(deps: McpDeps): Promise<McpServerConfig | undefined> {
  if (!deps.existsSync(getGitHubAuthPath())) return undefined;

  if (!isGitHubMcpServerAvailable(deps)) {
    logger.warn("github-mcp-server binary not found — skipping GitHub MCP auto-configuration");
    return undefined;
  }

  try {
    const { token, permissions } = await deps.getInstallationToken();
    const toolsets = mapPermissionsToToolsets(permissions);

    if (!toolsets) {
      logger.warn(
        "GitHub App token has no permissions that map to MCP toolsets — skipping GitHub MCP auto-configuration",
      );
      return undefined;
    }

    // GitHub App installation tokens can't use org-scoped search or /user endpoints.
    // Exclude tools that require PAT-level access to avoid 403s, and tools that
    // overlap with Clack's own tools (which resolve owner/repo from config correctly).
    const excludedTools = [
      "search_pull_requests",
      "search_issues",
      "search_code",
      "search_repositories",
      "search_users",
      "get_me",
      // Clack's find_pull_requests resolves owner/repo from config — the MCP version
      // requires Claude to guess the org name, which it often gets wrong.
      "list_pull_requests",
    ];

    logger.debug(`Auto-configured GitHub MCP server (toolsets: ${toolsets})`);
    return {
      type: "stdio",
      command: "github-mcp-server",
      args: ["stdio", "--exclude-tools", excludedTools.join(",")],
      env: {
        GITHUB_PERSONAL_ACCESS_TOKEN: token,
        GITHUB_TOOLSETS: toolsets,
      },
    };
  } catch (error) {
    logger.warn("Failed to auto-configure GitHub MCP server:", error);
    return undefined;
  }
}

/**
 * Loads MCP server configurations from data/mcp.json and optionally
 * auto-injects a GitHub MCP server from GitHub App credentials.
 *
 * Static config from mcp.json is cached. The GitHub MCP entry is rebuilt
 * per call to ensure a fresh token.
 */
export async function loadMcpServers(
  deps: McpDeps = defaultMcpDeps,
): Promise<Record<string, McpServerConfig> | undefined> {
  const staticServers = loadStaticMcpConfig(deps);

  // Skip auto-inject if the operator explicitly configured github in mcp.json.
  const hasManualGitHub = staticServers && "github" in staticServers;
  if (hasManualGitHub) return staticServers;

  const githubEntry = await buildGithubMcpEntry(deps);
  if (!githubEntry) return staticServers;

  return { ...staticServers, github: githubEntry };
}

/**
 * Load a single MCP server's config by name. Used by `attach_integration` to
 * materialize one server on demand without pulling in every other server.
 *
 * For `github`: honors an explicit `mcp.json` entry if present, otherwise falls
 * back to the auto-inject path (minting a fresh GitHub App token).
 * For all other names: returns the entry from `mcp.json` or undefined if absent.
 */
export async function loadMcpServer(
  name: string,
  deps: McpDeps = defaultMcpDeps,
): Promise<McpServerConfig | undefined> {
  if (name === "github") {
    const staticServers = loadStaticMcpConfig(deps);
    if (staticServers && "github" in staticServers) return staticServers.github;
    return buildGithubMcpEntry(deps);
  }

  const staticServers = loadStaticMcpConfig(deps);
  return staticServers?.[name];
}

/**
 * Load the subset of MCP servers that should be attached at session start —
 * every server whose registry entry has `alwaysLoad: true`. Servers tagged
 * `alwaysLoad: false` (or absent from the registry) are not included; callers
 * must attach them dynamically via `attach_integration`.
 *
 * Returns undefined when no servers qualify (e.g., empty registry, all lazy).
 */
export async function loadAlwaysOnMcpServers(
  registry: McpServerRegistry,
  deps: McpDeps = defaultMcpDeps,
): Promise<Record<string, McpServerConfig> | undefined> {
  const allServers = await loadMcpServers(deps);
  if (!allServers) return undefined;

  const result: Record<string, McpServerConfig> = {};
  for (const [name, cfg] of Object.entries(allServers)) {
    if (registry[name]?.alwaysLoad) {
      result[name] = cfg;
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Returns the names of configured MCP servers (without loading/connecting).
 * Uses only the cached static config (synchronous).
 */
export function getConfiguredMcpServerNames(deps: McpDeps = defaultMcpDeps): string[] {
  const servers = loadStaticMcpConfig(deps);
  const names = servers ? Object.keys(servers) : [];

  // Include "github" if auto-config conditions are met
  if (
    !names.includes("github") &&
    deps.existsSync(getGitHubAuthPath()) &&
    isGitHubMcpServerAvailable(deps)
  ) {
    names.push("github");
  }

  return names;
}

/**
 * Reset all internal caches. Intended for testing only.
 */
export function resetMcpCache(): void {
  cachedStaticServers = undefined;
  staticConfigLoaded = false;
  binaryAvailable = null;
}

// ============================================================================
// Effective MCP registry (lazy loading)
// ============================================================================

/**
 * Default description used when Clack auto-injects the GitHub MCP server
 * without an explicit `config.mcpServers.github` entry.
 */
export const DEFAULT_GITHUB_REGISTRY_ENTRY: { alwaysLoad: false; description: string } = {
  alwaysLoad: false,
  description:
    "GitHub — pull requests, issues, reviews, code on github.com. Attach when the user mentions a PR/issue number, pastes a github.com URL, or asks about merge status.",
};

/**
 * Placeholder description used for unmapped `mcp.json` servers. Shown in the catalog
 * (if we ever surface it) and intended to prompt the operator to fill in a real one.
 */
export const UNMAPPED_REGISTRY_DESCRIPTION =
  "(unmapped — add a description in config.json to enable lazy loading)";

export interface ResolveEffectiveRegistryInput {
  /** `config.mcpServers` as parsed from `data/config.json` — may be undefined or empty. */
  configRegistry?: McpServerRegistry;
  /** Names of servers declared in `data/mcp.json` (keys only). */
  mcpServerNames: string[];
  /** True when Clack auto-injects the GitHub MCP server (no explicit `mcp.json` entry). */
  githubAutoInjected: boolean;
}

export interface ResolveEffectiveRegistryResult {
  /** Merged registry: config entries, plus synthetic entries for unmapped/auto-injected. */
  registry: McpServerRegistry;
  /** Names of MCP servers that had no explicit registry entry and got a synthetic fallback. */
  unmapped: string[];
}

/**
 * Merge the operator-supplied `config.mcpServers` with the actual MCP servers in play:
 *  - Every name in `mcpServerNames` that lacks a registry entry gets a synthetic
 *    `{ alwaysLoad: true, description: UNMAPPED_REGISTRY_DESCRIPTION }` entry added
 *    and is surfaced in `unmapped` so the caller can log a warning.
 *  - If GitHub is auto-injected and absent from the config registry, a default
 *    `DEFAULT_GITHUB_REGISTRY_ENTRY` is inserted (NOT reported as unmapped — it's
 *    a first-class feature, not a misconfig).
 *  - Startup never fails from a missing registry entry; functionality is preserved
 *    because synthetic entries are `alwaysLoad: true` (legacy behavior parity).
 *
 * The internal `clack` MCP is NOT included in the returned registry — it's handled
 * as an always-on implicit server everywhere it's needed.
 */
export function resolveEffectiveRegistry(
  input: ResolveEffectiveRegistryInput,
): ResolveEffectiveRegistryResult {
  const { configRegistry, mcpServerNames, githubAutoInjected } = input;
  const registry: McpServerRegistry = { ...configRegistry };
  const unmapped: string[] = [];

  for (const name of mcpServerNames) {
    if (!(name in registry)) {
      registry[name] = { alwaysLoad: true, description: UNMAPPED_REGISTRY_DESCRIPTION };
      unmapped.push(name);
    }
  }

  if (githubAutoInjected && !("github" in registry)) {
    registry.github = { ...DEFAULT_GITHUB_REGISTRY_ENTRY };
    // GitHub auto-inject is a first-class path — don't report as unmapped.
  }

  return { registry, unmapped };
}

/**
 * Substitutes environment variables in config values
 * Supports ${VAR_NAME} syntax
 */
function substituteEnvVars(env?: Record<string, string>): Record<string, string> | undefined {
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
