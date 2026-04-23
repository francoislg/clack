/**
 * Builds the "AVAILABLE SKILL PACKS" block injected into the user prompt so Claude
 * knows which lazy-loaded skill packs are available. Listed at pack level (one line
 * per pack) — individual skills are revealed on demand via `list_skill_pack_skills`.
 *
 * Parallels `buildIntegrationsCatalog` for MCP integrations.
 */

import type { SkillPluginRegistry } from "../config.js";

/**
 * Build the catalog block. Returns an empty string when no lazy packs are configured
 * (registry absent, or every entry is `lazyLoad: false`). The caller decides whether
 * to skip the entire section or emit an empty string.
 */
export function buildSkillPacksCatalog(registry: SkillPluginRegistry | undefined): string {
  if (!registry) return "";

  const listed = Object.entries(registry)
    .filter(([, entry]) => entry.lazyLoad === true)
    .sort(([a], [b]) => a.localeCompare(b));

  if (listed.length === 0) return "";

  const lines: string[] = [
    'AVAILABLE SKILL PACKS (call list_skill_pack_skills("pack") to browse, then load_skill("pack", "skill") to apply a specific skill):',
  ];
  for (const [name, entry] of listed) {
    lines.push(`- ${name} — ${entry.description}`);
  }
  lines.push(
    "When a question matches one of these packs, call list_skill_pack_skills first to see available skills, then load_skill for the specific skill that applies.",
  );

  return lines.join("\n");
}
