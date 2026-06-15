import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import type { IntentStore } from "../server.js";
import { textResult, errorResult } from "../helpers.js";
import { canManageUserSkill, canDeleteUserSkill } from "../../permissions.js";
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
    "Propose taking a user-created skill out of service. Default (no flag): a reversible soft-disable — the skill disappears from Claude's catalog and from load_skill but stays on disk and can be restored via propose_skill_restore (owner or admin+). With `delete: true`: a PERMANENT, irreversible removal of the skill's files — admin+ only, and allowed even on an already-disabled skill.",
    {
      name: z.string().describe("Slug of the skill to disable."),
      delete: z
        .boolean()
        .optional()
        .describe(
          "When true, permanently remove the skill instead of soft-disabling it. Irreversible; admin+ only.",
        ),
    },
    async (args) => {
      if (!ctx.config.userSkills?.enabled) {
        return errorResult("User-created skills are not enabled in this installation.");
      }

      const existing = deps.readUserSkill(args.name);
      if (!existing) return errorResult(`Skill '${args.name}' not found.`);

      if (args.delete) {
        if (!canDeleteUserSkill(ctx.role)) {
          return errorResult(
            `You do not have permission to permanently remove skill '${args.name}'. Only an admin or owner can. (Soft-disable, which is reversible, is available to the skill's owner.)`,
          );
        }
        const ref = intentStore.stage({ type: "skill_delete", slug: args.name });
        return textResult({
          ref,
          slug: args.name,
          applied: false,
          instruction:
            "STAGED — the skill has NOT been removed yet. This is PERMANENT and irreversible. Embed this ref in a submit_response action of type 'skill_delete'.",
        });
      }

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
