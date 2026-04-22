/**
 * Builds the "integrations catalog" block injected into the system prompt so Claude
 * knows which lazy-loaded MCP servers are available and when to attach each.
 *
 * The catalog lists every non-always-on registry entry with its `description`.
 * Always-on servers are omitted (their tools are already attached) and the internal
 * `clack` server is never listed.
 */

import type { McpServerRegistry } from "../config.js";

/** Server names that are handled internally and never shown in the catalog. */
const ALWAYS_HIDDEN_FROM_CATALOG: readonly string[] = ["clack"];

/**
 * Build the catalog block. Returns an empty string when no registry entries qualify
 * (all always-on, or registry empty). The caller decides whether to skip the entire
 * section or emit an empty string.
 */
export function buildIntegrationsCatalog(registry: McpServerRegistry): string {
  const listed = Object.entries(registry)
    .filter(([name, entry]) => !entry.alwaysLoad && !ALWAYS_HIDDEN_FROM_CATALOG.includes(name))
    .sort(([a], [b]) => a.localeCompare(b));

  if (listed.length === 0) return "";

  const lines: string[] = [
    'AVAILABLE INTEGRATIONS (call attach_integration("name") to load — it attaches the MCP server and the topic instructions in one step):',
  ];
  for (const [name, entry] of listed) {
    lines.push(`- ${name} — ${entry.description}`);
  }
  lines.push(
    'When a question matches one of these integrations, call attach_integration("name") as a first step before answering.',
  );

  return lines.join("\n");
}
