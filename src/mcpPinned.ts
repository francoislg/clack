import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { logger } from "./logger.js";

/**
 * A pinned stdio MCP entry: `data/mcp.json` declared `package` + `version`.
 * Resolved to a `node + binPath` spawn config by `installAllPinnedMcpServers`
 * at boot, then registered via `setPinnedSpawnConfig` (in `mcp.ts`).
 */
export interface PinnedEntry {
  package: string;
  version: string;
  args?: string[];
  env?: Record<string, string>;
}

/** Stdio-shaped raw entry from `mcp.json`. Mirror of the type in `mcp.ts`. */
export interface StdioMcpEntry {
  type?: "stdio";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  package?: string;
  version?: string;
}

export type StdioParseResult =
  | { kind: "pinned"; entry: PinnedEntry }
  | { kind: "legacy"; config: McpServerConfig };

let pinnedEntriesCache: Record<string, PinnedEntry> = {};
const warnedNpxLegacy = new Set<string>();

/**
 * Parse one stdio entry from `mcp.json`. Validates partial pins (throws),
 * emits the once-per-process npx-migration warning, and returns either a
 * pinned `PinnedEntry` or a resolved legacy spawn config.
 *
 * The caller (mcp.ts's `loadStaticMcpConfig`) collects all pinned results,
 * then calls `recordPinnedEntries` to populate the cache.
 */
export function parseStdioEntry(
  name: string,
  stdio: StdioMcpEntry,
  substituteEnvVars: (env?: Record<string, string>) => Record<string, string> | undefined,
): StdioParseResult {
  const hasPackage = typeof stdio.package === "string" && stdio.package.length > 0;
  const hasVersion = typeof stdio.version === "string" && stdio.version.length > 0;

  if (hasPackage !== hasVersion) {
    throw new Error(
      `MCP entry '${name}': '${hasPackage ? "package" : "version"}' is set but '${hasPackage ? "version" : "package"}' is missing. Both fields are required for pinned installs.`,
    );
  }

  if (hasPackage && hasVersion) {
    return {
      kind: "pinned",
      entry: {
        package: stdio.package as string,
        version: stdio.version as string,
        ...(stdio.args ? { args: stdio.args } : {}),
        env: substituteEnvVars(stdio.env),
      },
    };
  }

  if (stdio.command === "npx" && !warnedNpxLegacy.has(name)) {
    warnedNpxLegacy.add(name);
    logger.warn(
      `MCP '${name}' uses npx — consider migrating to package/version for reliable installs`,
    );
  }
  if (!stdio.command) {
    throw new Error(
      `MCP entry '${name}': stdio entry must declare either 'command' or 'package'+'version'`,
    );
  }

  return {
    kind: "legacy",
    config: {
      type: "stdio",
      command: stdio.command,
      args: stdio.args,
      env: substituteEnvVars(stdio.env),
    },
  };
}

/** Replace the pinned-entry cache. Called once per `loadStaticMcpConfig`. */
export function recordPinnedEntries(map: Record<string, PinnedEntry>): void {
  pinnedEntriesCache = map;
}

/** Defensive copy of the pinned-entry cache. */
export function getPinnedEntriesCache(): Record<string, PinnedEntry> {
  return { ...pinnedEntriesCache };
}

/** Names of currently-cached pinned entries. */
export function pinnedNames(): string[] {
  return Object.keys(pinnedEntriesCache);
}

/** Reset module-level state. For testing. */
export function resetPinnedState(): void {
  pinnedEntriesCache = {};
  warnedNpxLegacy.clear();
}
