import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import type { IntentStore } from "../server.js";
import { textResult, errorResult } from "../helpers.js";
import { canEditUserSkill } from "../../permissions.js";
import {
  validateDescription as defaultValidateDescription,
  readUserSkill as defaultReadUserSkill,
} from "../../userSkills.js";

export interface ProposeSkillUpdateDeps {
  validateDescription: typeof defaultValidateDescription;
  readUserSkill: typeof defaultReadUserSkill;
}

export const defaultProposeSkillUpdateDeps: ProposeSkillUpdateDeps = {
  validateDescription: defaultValidateDescription,
  readUserSkill: defaultReadUserSkill,
};

export function createProposeSkillUpdateTool(
  ctx: QueryToolContext,
  intentStore: IntentStore,
  deps: ProposeSkillUpdateDeps = defaultProposeSkillUpdateDeps,
) {
  return tool(
    "propose_skill_update",
    "Propose an update to an existing user-created skill. At least one of `description` or `body` is required. Stages the intent and returns a ref ID. The owner of the skill can update freely; admins+ can update any skill. Set `auto: true` on the matching action when the user clearly asked for the edit.",
    {
      name: z.string().describe("Slug of the existing skill to update."),
      description: z
        .string()
        .optional()
        .describe("New trigger description (1-1024 chars). Omit to keep the current value."),
      body: z.string().optional().describe("New SKILL.md body. Omit to keep the current value."),
    },
    async (args) => {
      if (!ctx.config.userSkills?.enabled) {
        return errorResult("User-created skills are not enabled in this installation.");
      }
      if (args.description === undefined && args.body === undefined) {
        return errorResult("Update requires at least one of `description` or `body`.");
      }

      const existing = deps.readUserSkill(args.name);
      if (!existing) return errorResult(`Skill '${args.name}' not found.`);
      if (existing.disabledAt) {
        return errorResult(
          `Skill '${args.name}' is disabled. Use propose_skill_restore to restore it before updating.`,
        );
      }
      if (!canEditUserSkill(ctx.role, existing.ownerUserId, ctx.userId)) {
        return errorResult(
          `You do not have permission to edit skill '${args.name}'. Only the owner (<@${existing.ownerUserId}>) or an admin can edit.`,
        );
      }

      if (args.description !== undefined) {
        const descCheck = deps.validateDescription(args.description);
        if (!descCheck.ok) return errorResult(`Invalid description: ${descCheck.reason}`);
      }

      const ref = intentStore.stage({
        type: "skill_update",
        slug: args.name,
        description: args.description?.trim(),
        body: args.body,
      });

      return textResult({
        ref,
        slug: args.name,
        applied: false,
        instruction:
          "STAGED — the skill has NOT been updated yet. Embed this ref in a submit_response action of type 'skill_update'. Set `auto: true` on the action when the user clearly asked for the edit.",
      });
    },
  );
}
