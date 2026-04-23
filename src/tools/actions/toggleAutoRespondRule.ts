import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import { toggleRule } from "../../autoRespond.js";
import { logger } from "../../logger.js";
import { errorMessage } from "../../errors.js";

export interface ToggleAutoRespondRuleDeps {
  toggleRule: typeof toggleRule;
}

export function createToggleAutoRespondRuleTool(
  _ctx: QueryToolContext,
  depsOverride?: Partial<ToggleAutoRespondRuleDeps>,
) {
  const deps: ToggleAutoRespondRuleDeps = {
    toggleRule,
    ...depsOverride,
  };

  return tool(
    "toggle_auto_respond_rule",
    "Toggle an auto-respond rule's enabled state (admin-only). Flips enabled=true to false and " +
      "vice-versa. Returns the new enabled state. If the user asks to 'disable a rule' or " +
      "'turn off tracking for channel X', call list_auto_respond_rules first to confirm which " +
      "rule to toggle.",
    {
      id: z.string().describe("The rule ID to toggle"),
    },
    async (args) => {
      try {
        const updated = await deps.toggleRule(args.id);
        if (!updated) {
          return errorResult(`Auto-respond rule "${args.id}" not found.`);
        }
        return textResult({
          ok: true,
          id: updated.id,
          enabled: updated.enabled,
        });
      } catch (error) {
        logger.error("Failed to toggle auto-respond rule:", error);
        return errorResult(`Failed to toggle auto-respond rule: ${errorMessage(error)}`);
      }
    },
  );
}
