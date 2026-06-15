import { discoverWorkerSkills, type WorkerSkill } from "./workerSkills.js";

/**
 * Render the WORKER SKILLS catalog block appended to the worker execution prompt. Lists each
 * resolved skill's trigger `description` (always in context) so Claude knows what's available;
 * bodies load on demand via `load_skill`. Returns "" when no skills resolve, so the caller
 * appends nothing and the prompt is unchanged.
 */
export function buildWorkerSkillsCatalog(skills: ReadonlyArray<WorkerSkill>): string {
  if (skills.length === 0) return "";

  const sorted = [...skills].sort((a, b) => a.slug.localeCompare(b.slug));
  const lines = [
    'WORKER SKILLS (call load_skill({ skill: "<slug>" }) to apply one to the current task):',
  ];
  for (const skill of sorted) {
    lines.push(`- ${skill.slug} — ${skill.description}`);
  }
  return lines.join("\n");
}

/**
 * Append the WORKER SKILLS catalog for `repoName` to a worker system prompt. When no skills
 * resolve, the prompt is returned unchanged (byte-identical), so callers stay additive.
 */
export function appendWorkerSkillsCatalog(systemPrompt: string, repoName: string): string {
  const catalog = buildWorkerSkillsCatalog(discoverWorkerSkills(repoName));
  return catalog ? `${systemPrompt}\n\n${catalog}` : systemPrompt;
}
