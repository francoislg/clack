import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { WorkerToolContext } from "../types.js";
import { errorResult } from "../helpers.js";
import { getWorkerSkillBody } from "../../changes/workerSkillsBodyCache.js";
import { readRepoSkillBody } from "../../changes/repoSkills.js";

/**
 * `load_skill({ skill })` — apply a skill by slug, resolved from two sources in order:
 *
 *   1. the target repo's own checkout at `<worktree>/.claude/skills/<slug>/SKILL.md`
 *      (worktree-local, read fresh each call — a repo skill takes precedence), then
 *   2. Clack's built-in worker skills (per-repo masks global, `configuration` masks
 *      `default_configuration`) via the mtime-keyed body cache so edits hot-reload.
 *
 * The frontmatter-stripped body is returned with a preamble naming its origin. An unknown slug
 * names both sources so Claude can self-correct (e.g. `Read` a non-standard repo path directly).
 */
export function createLoadSkillTool(ctx: Pick<WorkerToolContext, "repoName" | "worktreePath">) {
  return tool(
    "load_skill",
    "Apply a skill by slug — either a Clack worker skill (listed in the WORKER SKILLS block of your prompt) or one the target repository defines at .claude/skills/<slug>/SKILL.md. The skill's body is returned as the tool result — read it and follow its procedure.",
    {
      skill: z.string().describe("The skill slug, as listed in the WORKER SKILLS block."),
    },
    async (args) => {
      const repo = readRepoSkillBody(ctx.worktreePath, args.skill);
      if (repo.ok) {
        return skillResult(args.skill, "the repository's own .claude/skills/", repo.body);
      }
      const worker = getWorkerSkillBody(ctx.repoName, args.skill);
      if (worker.ok) {
        return skillResult(args.skill, "the worker skill catalog", worker.body);
      }
      return errorResult(
        `Skill '${args.skill}' not found: it is not a Clack worker skill (see the WORKER SKILLS block), and the repo has no .claude/skills/${args.skill}/SKILL.md.`,
      );
    },
  );
}

function skillResult(slug: string, origin: string, body: string) {
  const preamble = `Loaded skill '${slug}' from ${origin}. Apply its procedure to the current task.`;
  return {
    content: [{ type: "text" as const, text: `${preamble}\n\n---\n\n${body}` }],
  };
}
