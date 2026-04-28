import { join } from "path";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { logger } from "./logger.js";
import type { McpDeps } from "./mcp.js";

function getGitHubAuthPath(): string {
  return join(process.cwd(), "data", "auth", "github.json");
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

// Cache whether the github-mcp-server binary is available
let binaryAvailable: boolean | null = null;

/**
 * Check if the github-mcp-server binary is available on PATH.
 * Result is cached after first check.
 */
export function isGitHubMcpServerAvailable(deps: McpDeps): boolean {
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
export async function buildGithubMcpEntry(deps: McpDeps): Promise<McpServerConfig | undefined> {
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

/** Whether GitHub auto-inject conditions are met (for `getConfiguredMcpServerNames`). */
export function isGitHubAutoInjectable(deps: McpDeps): boolean {
  return deps.existsSync(getGitHubAuthPath()) && isGitHubMcpServerAvailable(deps);
}

/**
 * Default description used when Clack auto-injects the GitHub MCP server
 * without an explicit `config.mcpServers.github` entry.
 */
export const DEFAULT_GITHUB_REGISTRY_ENTRY: { alwaysLoad: false; description: string } = {
  alwaysLoad: false,
  description:
    "GitHub — pull requests, issues, reviews, code on github.com. Attach when the user mentions a PR/issue number, pastes a github.com URL, or asks about merge status.",
};

/** Reset all module-level caches. For testing. */
export function resetGithubCache(): void {
  binaryAvailable = null;
}
