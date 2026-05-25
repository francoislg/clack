/**
 * Builds the "AVAILABLE SKILL PACKS" block injected into the user prompt so Claude
 * knows which lazy-loaded skill packs are available. Lazy plugins are listed at
 * pack level (one line per pack — individual skills are revealed on demand via
 * `list_skill_pack_skills`). When the user-skills feature is enabled and at least
 * one user skill exists, a "USER SKILLS:" subsection enumerates each user-authored
 * skill inline by its trigger description (since each user skill has a unique
 * "when to use" — there's no pack-level summary that would do them justice).
 *
 * Parallels `buildIntegrationsCatalog` for MCP integrations.
 */

import type { SkillPluginRegistry } from "../config.js";

export interface UserSkillCatalogEntry {
  slug: string;
  description: string;
}

/**
 * Build the catalog block. Returns an empty string when no lazy packs are configured
 * AND no enabled user skills exist. The caller decides whether to skip the entire
 * section or emit an empty string.
 */
export function buildSkillPacksCatalog(
  registry: SkillPluginRegistry | undefined,
  userSkills?: ReadonlyArray<UserSkillCatalogEntry>,
): string {
  const lazyEntries = registry
    ? Object.entries(registry)
        .filter(([, entry]) => entry.lazyLoad === true)
        .sort(([a], [b]) => a.localeCompare(b))
    : [];

  const userSkillEntries = userSkills
    ? [...userSkills].sort((a, b) => a.slug.localeCompare(b.slug))
    : [];

  if (lazyEntries.length === 0 && userSkillEntries.length === 0) return "";

  const lines: string[] = [
    'AVAILABLE SKILL PACKS (call list_skill_pack_skills("pack") to browse, then load_skill("pack", "skill") to apply a specific skill):',
  ];

  for (const [name, entry] of lazyEntries) {
    lines.push(`- ${name} — ${entry.description}`);
  }

  if (lazyEntries.length > 0) {
    lines.push(
      "When a question matches one of these packs, call list_skill_pack_skills first to see available skills, then load_skill for the specific skill that applies.",
    );
  }

  if (userSkillEntries.length > 0) {
    lines.push("");
    lines.push(
      'USER SKILLS (org-authored, listed inline below; call load_skill({ pack: "user-skills", skill: "<slug>" }) to apply one):',
    );
    for (const entry of userSkillEntries) {
      lines.push(`- ${entry.slug} — ${entry.description}`);
    }
  }

  return lines.join("\n");
}
