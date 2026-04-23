import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { errorResult } from "../helpers.js";
import { updateSession as defaultUpdateSession } from "../../sessions.js";
import { errorMessage } from "../../errors.js";
import { logger } from "../../logger.js";

/**
 * `load_skill({ pack, skill })` — apply a specific skill from a lazy pack.
 * Returns the full SKILL.md body prefixed with a short preamble so Claude
 * treats it as instructions. Idempotent per `(pack, skill)` within a session:
 * repeat calls short-circuit with a pointer to the prior load.
 *
 * Delegates all registry/filesystem knowledge to `SkillsManager`.
 */

export interface LoadSkillDeps {
  updateSession: typeof defaultUpdateSession;
}

export const defaultLoadSkillDeps: LoadSkillDeps = {
  updateSession: defaultUpdateSession,
};

export function createLoadSkillTool(
  ctx: QueryToolContext,
  deps: LoadSkillDeps = defaultLoadSkillDeps,
) {
  return tool(
    "load_skill",
    "Apply a specific skill from a lazy-loaded skill pack. The SKILL.md body is returned as the tool result; read it and follow its guidance. Call list_skill_pack_skills first to see available skills in a pack.",
    {
      pack: z.string().describe("The skill pack name from the AVAILABLE SKILL PACKS catalog."),
      skill: z.string().describe("The skill name (from list_skill_pack_skills output)."),
    },
    async (args) => {
      const manager = ctx.skillsManager;
      if (!manager) {
        return errorResult(
          "load_skill is not available in this session. This is a bug — contact the operator.",
        );
      }

      if (manager.isEagerPack(args.pack)) {
        return errorResult(
          `Pack '${args.pack}' is eager-loaded — its skills are already available via the native Skill() tool. Call Skill("${args.skill}") directly instead of load_skill.`,
        );
      }

      if (!manager.knowsLazyPack(args.pack)) {
        const available = manager.knownLazyPackNames().join(", ") || "(none)";
        return errorResult(
          `Unknown skill pack: '${args.pack}'. Available lazy packs: ${available}.`,
        );
      }

      if (!manager.getSkill(args.pack, args.skill)) {
        return errorResult(
          `Skill '${args.skill}' not found in pack '${args.pack}'. Call list_skill_pack_skills("${args.pack}") to see available skills.`,
        );
      }

      // Idempotent short-circuit for repeat loads of the same (pack, skill) pair.
      if (manager.isSkillLoaded(args.pack, args.skill)) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Skill already loaded this session: '${args.skill}' from '${args.pack}'. Refer to the prior load above in the conversation for the full body.`,
            },
          ],
        };
      }

      let body: string;
      try {
        body = manager.readSkillBody(args.pack, args.skill);
      } catch (error) {
        return errorResult(
          `Failed to read skill body for '${args.pack}/${args.skill}': ${errorMessage(error)}`,
        );
      }

      const updatedLoaded = manager.markLoaded(args.pack, args.skill);
      try {
        await deps.updateSession(ctx.session.sessionId, { loadedSkills: updatedLoaded });
      } catch (error) {
        logger.warn(
          `Failed to persist loadedSkills for '${args.pack}/${args.skill}': ${errorMessage(error)}`,
        );
      }

      const preamble = `Loaded skill '${args.skill}' from pack '${args.pack}'. Apply its guidance to the current question.`;
      return {
        content: [
          {
            type: "text" as const,
            text: `${preamble}\n\n---\n\n${body}`,
          },
        ],
      };
    },
  );
}
