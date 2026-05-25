import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { errorResult } from "../helpers.js";
import { updateSession as defaultUpdateSession } from "../../sessions.js";
import { errorMessage } from "../../errors.js";
import { logger } from "../../logger.js";
import { getUserSkillBody } from "../../userSkillsBodyCache.js";

/**
 * `load_skill({ pack, skill })` — apply a specific skill from a lazy pack OR the
 * synthetic `user-skills` pack.
 *
 * For lazy-tagged plugin packs: returns the full SKILL.md body with a preamble; loads
 * are session-idempotent (recorded in `session.loadedSkills`).
 *
 * For `pack: "user-skills"` (when `userSkills.enabled === true`): reads from
 * `data/user-skills/<skill>/SKILL.md` via a process-level mtime-keyed cache. Unlike
 * lazy-plugin loads, these are NOT recorded in `session.loadedSkills` — the mtime
 * check supersedes session dedup so edits propagate within the same session.
 */

export interface LoadSkillDeps {
  updateSession: typeof defaultUpdateSession;
}

export const defaultLoadSkillDeps: LoadSkillDeps = {
  updateSession: defaultUpdateSession,
};

const USER_SKILLS_PACK = "user-skills";

export function createLoadSkillTool(
  ctx: QueryToolContext,
  deps: LoadSkillDeps = defaultLoadSkillDeps,
) {
  return tool(
    "load_skill",
    "Apply a specific skill from a lazy-loaded skill pack OR from the org's user-skills pack. The SKILL.md body is returned as the tool result; read it and follow its guidance. For lazy plugin packs, call list_skill_pack_skills first to see available skills. For the 'user-skills' pack, the available skill names are listed inline in the AVAILABLE SKILL PACKS catalog block.",
    {
      pack: z
        .string()
        .describe("The skill pack name. Use 'user-skills' for the org's user-created skills."),
      skill: z.string().describe("The skill name (slug)."),
    },
    async (args) => {
      // user-skills branch: bypass the SkillsManager entirely. The body cache + on-disk
      // reads cover everything; lazy-pack idempotency does not apply here.
      if (args.pack === USER_SKILLS_PACK) {
        if (!ctx.config.userSkills?.enabled) {
          return errorResult(
            `Unknown skill pack: '${args.pack}'. The user-skills feature is not enabled in this installation.`,
          );
        }
        const res = getUserSkillBody(args.skill);
        if (!res.ok) {
          return errorResult(
            `Skill '${args.skill}' not found in pack 'user-skills'. Consult the USER SKILLS list in the AVAILABLE SKILL PACKS block to see the available skills.`,
          );
        }
        const preamble = `Loaded skill '${args.skill}' from pack 'user-skills'. Apply its guidance to the current question.`;
        return {
          content: [
            {
              type: "text" as const,
              text: `${preamble}\n\n---\n\n${res.body}`,
            },
          ],
        };
      }

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
        const lazy = manager.knownLazyPackNames();
        const available = lazy.length > 0 ? lazy.join(", ") : "(none)";
        const userSkillsHint = ctx.config.userSkills?.enabled
          ? ` Also available: 'user-skills' (see the USER SKILLS list in the catalog).`
          : "";
        return errorResult(
          `Unknown skill pack: '${args.pack}'. Available lazy packs: ${available}.${userSkillsHint}`,
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
