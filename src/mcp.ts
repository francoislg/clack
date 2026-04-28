import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { getInstallationToken } from "./github.js";
import { logger } from "./logger.js";
import type { McpServerRegistry } from "./config.js";
import {
  buildGithubMcpEntry,
  DEFAULT_GITHUB_REGISTRY_ENTRY as GITHUB_DEFAULT_REGISTRY,
  isGitHubAutoInjectable,
  resetGithubCache,
} from "./mcpGithub.js";
import {
  getPinnedEntriesCache,
  parseStdioEntry,
  pinnedNames,
  recordPinnedEntries,
  resetPinnedState,
  type PinnedEntry,
  type StdioMcpEntry,
} from "./mcpPinned.js";

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

interface McpRemoteConfig {
  type: "sse" | "http";
  url: string;
  headers?: Record<string, string>;
}

type McpServerEntry = StdioMcpEntry | McpRemoteConfig;

interface McpConfig {
  mcpServers?: Record<string, McpServerEntry>;
}

function isRemoteEntry(entry: McpServerEntry): entry is McpRemoteConfig {
  return entry.type === "sse" || entry.type === "http";
}

// Re-export types/constants that other modules import from mcp.ts.
export type { PinnedEntry } from "./mcpPinned.js";
export const DEFAULT_GITHUB_REGISTRY_ENTRY = GITHUB_DEFAULT_REGISTRY;

// Cache the static MCP config from mcp.json (parsed once).
// Holds spawn configs for legacy-shape entries and, after install, the resolved
// node-binary spawn configs for pinned entries (set via setPinnedSpawnConfig).
let cachedStaticServers: Record<string, McpServerConfig> | undefined;
let staticConfigLoaded = false;

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

  let config: McpConfig;
  try {
    const raw = deps.readFileSync(getMcpConfigPath(), "utf-8");
    config = JSON.parse(raw);
  } catch (error) {
    logger.error("Failed to load MCP configuration:", error);
    return undefined;
  }

  if (!config.mcpServers || Object.keys(config.mcpServers).length === 0) {
    logger.debug("MCP config file exists but has no servers configured");
    return undefined;
  }

  // Validation errors (partial pin, missing command) propagate to the caller —
  // boot must fail fast on a misconfigured mcp.json, unlike a parse/IO error
  // (handled above) which keeps the bot running without external MCPs.
  const result: Record<string, McpServerConfig> = {};
  const pinned: Record<string, PinnedEntry> = {};
  for (const [name, server] of Object.entries(config.mcpServers)) {
    if (isRemoteEntry(server)) {
      result[name] = {
        type: server.type,
        url: server.url,
        headers: substituteEnvVars(server.headers),
      };
      continue;
    }

    const parsed = parseStdioEntry(name, server, substituteEnvVars);
    if (parsed.kind === "pinned") {
      pinned[name] = parsed.entry;
    } else {
      result[name] = parsed.config;
    }
  }

  cachedStaticServers = result;
  recordPinnedEntries(pinned);
  logger.debug(`Loaded MCP config: ${[...Object.keys(result), ...Object.keys(pinned)].join(", ")}`);
  return result;
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
 * Uses only the cached static config (synchronous). Includes pinned entries
 * even before their install has resolved — the registry needs to know about
 * them for catalog/Home-tab purposes.
 */
export function getConfiguredMcpServerNames(deps: McpDeps = defaultMcpDeps): string[] {
  const servers = loadStaticMcpConfig(deps);
  const names = new Set<string>(servers ? Object.keys(servers) : []);
  for (const name of pinnedNames()) names.add(name);
  if (!names.has("github") && isGitHubAutoInjectable(deps)) names.add("github");
  return [...names];
}

/**
 * Reset all internal caches. Intended for testing only.
 */
export function resetMcpCache(): void {
  cachedStaticServers = undefined;
  staticConfigLoaded = false;
  resetGithubCache();
  resetPinnedState();
}

/**
 * Returns the pinned entries declared in `data/mcp.json` — those with both
 * `package` and `version` set. Result is populated after `loadStaticMcpConfig`
 * has run (typically the first MCP load call).
 */
export function getPinnedEntries(deps: McpDeps = defaultMcpDeps): Record<string, PinnedEntry> {
  loadStaticMcpConfig(deps);
  return getPinnedEntriesCache();
}

/**
 * Record a resolved spawn config for a pinned entry. Called by the boot-time
 * installer after `ensureInstalled` returns a bin path. Subsequent
 * `loadMcpServer(name)` calls will return this config.
 */
export function setPinnedSpawnConfig(name: string, config: McpServerConfig): void {
  if (!cachedStaticServers) cachedStaticServers = {};
  cachedStaticServers[name] = config;
}

// ============================================================================
// Effective MCP registry (lazy loading)
// ============================================================================

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
    registry.github = { ...GITHUB_DEFAULT_REGISTRY };
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
