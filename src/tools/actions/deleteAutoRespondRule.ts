import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import { deleteRule } from "../../autoRespond.js";
import { logger } from "../../logger.js";
import { errorMessage } from "../../errors.js";

export interface DeleteAutoRespondRuleDeps {
  deleteRule: typeof deleteRule;
}

export function createDeleteAutoRespondRuleTool(
  _ctx: QueryToolContext,
  depsOverride?: Partial<DeleteAutoRespondRuleDeps>,
) {
  const deps: DeleteAutoRespondRuleDeps = {
    deleteRule,
    ...depsOverride,
  };

  return tool(
    "delete_auto_respond_rule",
    "Permanently delete an auto-respond rule by ID (admin-only). This is destructive and " +
      "non-reversible. If the user says 'remove the rule for X' without a rule ID, call " +
      "list_auto_respond_rules first and confirm the specific rule to delete — do NOT guess. " +
      "Prefer toggle_auto_respond_rule for a reversible disable.",
    {
      id: z.string().describe("The rule ID to delete"),
    },
    async (args) => {
      try {
        const removed = await deps.deleteRule(args.id);
        if (!removed) {
          return errorResult(`Auto-respond rule "${args.id}" not found.`);
        }
        return textResult({
          ok: true,
          id: args.id,
          deleted: true,
        });
      } catch (error) {
        logger.error("Failed to delete auto-respond rule:", error);
        return errorResult(`Failed to delete auto-respond rule: ${errorMessage(error)}`);
      }
    },
  );
}
