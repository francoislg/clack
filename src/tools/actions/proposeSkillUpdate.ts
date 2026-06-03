import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import type { IntentStore } from "../server.js";
import { textResult, errorResult } from "../helpers.js";
import { canEditUserSkillContent, canManageUserSkill } from "../../permissions.js";
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
    "Propose an update to an existing user-created skill. At least one of `description`, `body`, or `editable_by_anyone` is required. Stages the intent and returns a ref ID. The owner of the skill (or an admin+) can edit content freely; a skill marked editable-by-everyone can have its content edited by any member. Only the owner or an admin+ can change the `editable_by_anyone` setting. Set `auto: true` on the matching action when the user clearly asked for the edit.",
    {
      name: z.string().describe("Slug of the existing skill to update."),
      description: z
        .string()
        .optional()
        .describe(
          'New trigger description (1-1024 chars). Omit to keep the current value. Shown to Claude in every prompt — this is the ONLY signal Claude has for deciding to load the skill, so write it for high recall. Format: start with the literal phrases a user might say to invoke the skill ("Use when the user asks to <X>, be a <Y>, act as <Z>..."), then list the topic keywords/synonyms that should also fire it ("...or when the conversation involves <topic1>, <topic2>, <topic3>"), then one short clause naming the persona/behavior it activates. Avoid generic phrasing — it under-triggers.',
        ),
      body: z.string().optional().describe("New SKILL.md body. Omit to keep the current value."),
      editable_by_anyone: z
        .boolean()
        .optional()
        .describe(
          "Whether any member may edit this skill's content (not just the owner/admins). Omit to keep the current setting. Changing this requires being the owner or an admin+.",
        ),
    },
    async (args) => {
      if (!ctx.config.userSkills?.enabled) {
        return errorResult("User-created skills are not enabled in this installation.");
      }
      if (
        args.description === undefined &&
        args.body === undefined &&
        args.editable_by_anyone === undefined
      ) {
        return errorResult(
          "Update requires at least one of `description`, `body`, or `editable_by_anyone`.",
        );
      }

      const existing = deps.readUserSkill(args.name);
      if (!existing) return errorResult(`Skill '${args.name}' not found.`);
      if (existing.disabledAt) {
        return errorResult(
          `Skill '${args.name}' is disabled. Use propose_skill_restore to restore it before updating.`,
        );
      }

      const editsContent = args.description !== undefined || args.body !== undefined;
      if (
        editsContent &&
        !canEditUserSkillContent(
          ctx.role,
          existing.ownerUserId,
          ctx.userId,
          existing.editableByAnyone ?? false,
        )
      ) {
        return errorResult(
          `You do not have permission to edit skill '${args.name}'. Only the owner (<@${existing.ownerUserId}>), an admin, or anyone (if the skill is editable by everyone) can edit its content.`,
        );
      }
      if (
        args.editable_by_anyone !== undefined &&
        !canManageUserSkill(ctx.role, existing.ownerUserId, ctx.userId)
      ) {
        return errorResult(
          `You do not have permission to change the editable-by-everyone setting for skill '${args.name}'. Only the owner (<@${existing.ownerUserId}>) or an admin can.`,
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
        editableByAnyone: args.editable_by_anyone,
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
