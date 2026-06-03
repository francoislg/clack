import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import type { IntentStore } from "../server.js";
import { textResult, errorResult } from "../helpers.js";
import { canManageUserSkill } from "../../permissions.js";
import { readUserSkill as defaultReadUserSkill } from "../../userSkills.js";

export interface ProposeSkillDisableDeps {
  readUserSkill: typeof defaultReadUserSkill;
}

export const defaultProposeSkillDisableDeps: ProposeSkillDisableDeps = {
  readUserSkill: defaultReadUserSkill,
};

export function createProposeSkillDisableTool(
  ctx: QueryToolContext,
  intentStore: IntentStore,
  deps: ProposeSkillDisableDeps = defaultProposeSkillDisableDeps,
) {
  return tool(
    "propose_skill_disable",
    "Propose disabling a user-created skill (soft delete). Disabled skills disappear from Claude's catalog and from load_skill, but stay on disk and can be restored via propose_skill_restore. Owner or admin+ only.",
    {
      name: z.string().describe("Slug of the skill to disable."),
    },
    async (args) => {
      if (!ctx.config.userSkills?.enabled) {
        return errorResult("User-created skills are not enabled in this installation.");
      }

      const existing = deps.readUserSkill(args.name);
      if (!existing) return errorResult(`Skill '${args.name}' not found.`);
      if (existing.disabledAt) return errorResult(`Skill '${args.name}' is already disabled.`);
      if (!canManageUserSkill(ctx.role, existing.ownerUserId, ctx.userId)) {
        return errorResult(
          `You do not have permission to disable skill '${args.name}'. Only the owner (<@${existing.ownerUserId}>) or an admin can disable.`,
        );
      }

      const ref = intentStore.stage({ type: "skill_disable", slug: args.name });
      return textResult({
        ref,
        slug: args.name,
        applied: false,
        instruction:
          "STAGED — the skill has NOT been disabled yet. Embed this ref in a submit_response action of type 'skill_disable'.",
      });
    },
  );
}
