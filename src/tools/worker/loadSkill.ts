import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { WorkerToolContext } from "../types.js";
import { errorResult } from "../helpers.js";
import { getWorkerSkillBody } from "../../changes/workerSkillsBodyCache.js";

/**
 * `load_skill({ skill })` — apply a worker skill by slug. Resolves the body for this run's
 * repository (per-repo masks global, `configuration` masks `default_configuration`) through
 * the mtime-keyed cache so edits hot-reload within the run. Returns the SKILL.md body with a
 * short preamble; an unknown slug points Claude back to the WORKER SKILLS catalog. Single
 * source — no `pack` argument (unlike the query-mode tool).
 */
export function createLoadSkillTool(ctx: Pick<WorkerToolContext, "repoName">) {
  return tool(
    "load_skill",
    "Apply a worker skill by slug. The skill's body is returned as the tool result — read it and follow its procedure. Available skill slugs are listed inline in the WORKER SKILLS block of your prompt.",
    {
      skill: z.string().describe("The skill slug, as listed in the WORKER SKILLS block."),
    },
    async (args) => {
      const result = getWorkerSkillBody(ctx.repoName, args.skill);
      if (!result.ok) {
        return errorResult(
          `Skill '${args.skill}' not found. Consult the WORKER SKILLS block in your prompt for the available skill slugs.`,
        );
      }
      const preamble = `Loaded skill '${args.skill}'. Apply its procedure to the current task.`;
      return {
        content: [{ type: "text" as const, text: `${preamble}\n\n---\n\n${result.body}` }],
      };
    },
  );
}
