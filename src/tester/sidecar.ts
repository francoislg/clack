import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { logger } from "../logger.js";
import { errorMessage } from "../errors.js";

export interface SidecarDeps {
  fetch: typeof globalThis.fetch;
}

export const defaultSidecarDeps: SidecarDeps = {
  fetch: (...args) => globalThis.fetch(...args),
};

/**
 * Probe the Playwright MCP sidecar's HTTP endpoint. Any HTTP response counts as
 * reachable (the MCP protocol handshake happens later, via the SDK); only a network
 * failure or timeout means the sidecar isn't there.
 */
export async function checkSidecarReachable(
  sidecarUrl: string,
  deps: SidecarDeps = defaultSidecarDeps,
): Promise<boolean> {
  try {
    await deps.fetch(sidecarUrl, { method: "HEAD", signal: AbortSignal.timeout(3000) });
    return true;
  } catch (err) {
    logger.warn(`Playwright sidecar unreachable at ${sidecarUrl}: ${errorMessage(err)}`);
    return false;
  }
}

/** SDK server entry for the sidecar's Playwright MCP (remote HTTP transport). */
export function buildPlaywrightMcpServerConfig(sidecarUrl: string): McpServerConfig {
  return { type: "http", url: sidecarUrl };
}
