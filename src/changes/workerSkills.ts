import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { getConfigurationDir, getDefaultConfigurationDir } from "../config.js";
import { resolveInstructionFile } from "../instructions.js";
import { logger } from "../logger.js";
import { parseFrontmatter, extractBody, validateSlug } from "../userSkills.js";

/**
 * Worker skills are built-in, overridable procedure files the Changes Workflow worker
 * loads on demand. Each is a `SKILL.md` (frontmatter `description` = trigger, body =
 * procedure) resolved through the two-tier instruction chain — `configuration/` masks
 * `default_configuration/` — in two scopes:
 *
 *   - global:   `skills/<slug>/SKILL.md`
 *   - per-repo: `<repo>/skills/<slug>/SKILL.md`
 *
 * Per-repo wins over global for the same slug; within a scope, `configuration/` wins over
 * `default_configuration/`. The trigger `description` renders into the worker prompt's
 * WORKER SKILLS catalog; bodies load lazily via the worker `load_skill` tool.
 */

export interface WorkerSkill {
  slug: string;
  description: string;
}

/**
 * Resolve the winning `SKILL.md` path for a (repo, slug), or null if none exists. Per-repo scope
 * wins over global; within each scope `resolveInstructionFile` applies the `configuration/` over
 * `default_configuration/` two-tier precedence.
 */
function resolveSkillPath(repoName: string, slug: string): string | null {
  return (
    resolveInstructionFile(join(repoName, "skills", slug, "SKILL.md")) ??
    resolveInstructionFile(join("skills", slug, "SKILL.md"))
  );
}

/** The four `skills/` parent directories whose subdirectories name candidate slugs. */
function skillsRoots(repoName: string): string[] {
  const config = getConfigurationDir();
  const def = getDefaultConfigurationDir();
  return [
    join(config, repoName, "skills"),
    join(def, repoName, "skills"),
    join(config, "skills"),
    join(def, "skills"),
  ];
}

function listSlugs(repoName: string): string[] {
  const slugs = new Set<string>();
  for (const root of skillsRoots(repoName)) {
    if (!existsSync(root)) continue;
    let entries: string[];
    try {
      entries = readdirSync(root);
    } catch (error) {
      logger.debug(`Failed to enumerate worker-skills dir '${root}': ${error}`);
      continue;
    }
    for (const entry of entries) {
      try {
        if (!statSync(join(root, entry)).isDirectory()) continue;
      } catch {
        continue;
      }
      if (!validateSlug(entry).ok) {
        logger.debug(`Worker-skill directory '${entry}' has an invalid slug — skipped`);
        continue;
      }
      slugs.add(entry);
    }
  }
  return [...slugs];
}

/** Read the resolved `SKILL.md` for a (repo, slug) and return its trimmed description, or null. */
function readDescription(repoName: string, slug: string): string | null {
  const path = resolveSkillPath(repoName, slug);
  if (!path) return null;
  let content: string;
  try {
    content = readFileSync(path, "utf-8");
  } catch (error) {
    logger.debug(`Failed to read worker-skill SKILL.md at '${path}': ${error}`);
    return null;
  }
  const description = parseFrontmatter(content).description?.trim();
  if (!description) {
    logger.debug(`Worker-skill '${slug}' missing a non-empty description — skipped`);
    return null;
  }
  return description;
}

/**
 * Discover every worker skill resolvable for `repoName`, applying per-repo-masks-global and
 * `configuration`-masks-`default_configuration` precedence. Skills with an invalid slug,
 * missing/unreadable `SKILL.md`, or an empty `description` are skipped. Never throws.
 */
export function discoverWorkerSkills(repoName: string): WorkerSkill[] {
  const skills: WorkerSkill[] = [];
  for (const slug of listSlugs(repoName)) {
    const description = readDescription(repoName, slug);
    if (description) skills.push({ slug, description });
  }
  return skills;
}

export type ReadWorkerSkillBodyResult = { ok: true; body: string } | { ok: false };

/**
 * Resolve and read a single worker skill's body for `repoName`, applying the same precedence
 * as discovery. Returns `{ ok: false }` when the slug is unknown or the file is unreadable;
 * never throws.
 */
export function readWorkerSkillBody(repoName: string, slug: string): ReadWorkerSkillBodyResult {
  if (!validateSlug(slug).ok) return { ok: false };
  const path = resolveSkillPath(repoName, slug);
  if (!path) return { ok: false };
  try {
    return { ok: true, body: extractBody(readFileSync(path, "utf-8")) };
  } catch (error) {
    logger.debug(`Failed to read worker-skill body at '${path}': ${error}`);
    return { ok: false };
  }
}

/** Resolved mtime (ms) of the winning `SKILL.md` for a (repo, slug), or null. Used by the body cache. */
export function getWorkerSkillMtimeMs(repoName: string, slug: string): number | null {
  if (!validateSlug(slug).ok) return null;
  const path = resolveSkillPath(repoName, slug);
  if (!path) return null;
  try {
    return statSync(path).mtimeMs;
  } catch (error) {
    logger.debug(`Failed to stat worker-skill at '${path}': ${error}`);
    return null;
  }
}
