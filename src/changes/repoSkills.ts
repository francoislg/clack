import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../logger.js";
import { extractBody, validateSlug } from "../userSkills.js";

export type ReadRepoSkillBodyResult = { ok: true; body: string } | { ok: false };

/**
 * Read a skill the target repository ships in its own checkout at
 * `<worktree>/.claude/skills/<slug>/SKILL.md`, returning the frontmatter-stripped body.
 *
 * Worktree-local and never cached — the content varies per checked-out branch, so every call
 * reads fresh. `validateSlug` (no slashes/dots) keeps the slug from escaping the skills dir.
 * Returns `{ ok: false }` for an invalid slug or a missing/unreadable file; never throws.
 */
export function readRepoSkillBody(worktreePath: string, slug: string): ReadRepoSkillBodyResult {
  if (!validateSlug(slug).ok) return { ok: false };
  const path = join(worktreePath, ".claude", "skills", slug, "SKILL.md");
  if (!existsSync(path)) return { ok: false };
  try {
    return { ok: true, body: extractBody(readFileSync(path, "utf-8")) };
  } catch (error) {
    logger.debug(`Failed to read repo skill at '${path}': ${error}`);
    return { ok: false };
  }
}
