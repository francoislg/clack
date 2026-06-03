import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import type { IntentStore } from "../server.js";
import { textResult, errorResult } from "../helpers.js";
import { canManageUserSkill } from "../../permissions.js";
import { readUserSkill as defaultReadUserSkill } from "../../userSkills.js";

export interface ProposeSkillRestoreDeps {
  readUserSkill: typeof defaultReadUserSkill;
}

export const defaultProposeSkillRestoreDeps: ProposeSkillRestoreDeps = {
  readUserSkill: defaultReadUserSkill,
};

export function createProposeSkillRestoreTool(
  ctx: QueryToolContext,
  intentStore: IntentStore,
  deps: ProposeSkillRestoreDeps = defaultProposeSkillRestoreDeps,
) {
  return tool(
    "propose_skill_restore",
    "Propose restoring a disabled user-created skill — clears its disabledAt timestamp so it re-appears in the catalog and load_skill can fetch it again. Owner or admin+ only.",
    {
      name: z.string().describe("Slug of the disabled skill to restore."),
    },
    async (args) => {
      if (!ctx.config.userSkills?.enabled) {
        return errorResult("User-created skills are not enabled in this installation.");
      }

      const existing = deps.readUserSkill(args.name);
      if (!existing) return errorResult(`Skill '${args.name}' not found.`);
      if (!existing.disabledAt) return errorResult(`Skill '${args.name}' is not disabled.`);
      if (!canManageUserSkill(ctx.role, existing.ownerUserId, ctx.userId)) {
        return errorResult(
          `You do not have permission to restore skill '${args.name}'. Only the owner (<@${existing.ownerUserId}>) or an admin can restore.`,
        );
      }

      const ref = intentStore.stage({ type: "skill_restore", slug: args.name });
      return textResult({
        ref,
        slug: args.name,
        applied: false,
        instruction:
          "STAGED — the skill has NOT been restored yet. Embed this ref in a submit_response action of type 'skill_restore'.",
      });
    },
  );
}
