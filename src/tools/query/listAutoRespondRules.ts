import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { textResult } from "../helpers.js";
import { getRules } from "../../autoRespond.js";

export function createListAutoRespondRulesTool(_ctx: QueryToolContext) {
  return tool(
    "list_auto_respond_rules",
    "List all auto-respond rules (admin-only). Returns each rule's id, channels (as Slack channel IDs), " +
      "optional userFilters, keywords, extraContext, preAnalysisContext, and enabled state. " +
      "Use this to review existing rules before adding or modifying one.",
    {
      _placeholder: z.boolean().optional().describe("Unused parameter (tool takes no input)"),
    },
    async () => {
      const rules = await getRules();
      return textResult({
        ok: true,
        count: rules.length,
        rules,
      });
    },
  );
}
