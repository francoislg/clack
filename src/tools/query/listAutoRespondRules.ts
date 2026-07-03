import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { textResult } from "../helpers.js";
import { getRules } from "../../autoRespond.js";
import { isEphemeralRule } from "../../ephemeralRules.js";

export function createListAutoRespondRulesTool(_ctx: QueryToolContext) {
  return tool(
    "list_auto_respond_rules",
    "List all auto-respond rules (admin-only). Returns each rule's id, channels (as Slack channel IDs), " +
      "optional userFilters, keywords, extraContext, preAnalysisContext, attentionLevel, and enabled state. " +
      'Entries with kind: "ephemeral" are channel conversations Clack is temporarily following (seeded by ' +
      "its own top-level posts) — read-only here except deletion; they carry their current attention level, " +
      "dormant state, linked-session count, and an anchor-text excerpt. " +
      "Use this to review existing rules before adding or modifying one.",
    {
      _placeholder: z.boolean().optional().describe("Unused parameter (tool takes no input)"),
    },
    async () => {
      const rules = await getRules();
      const now = Date.now();
      return textResult({
        ok: true,
        count: rules.length,
        rules: rules.map((rule) =>
          isEphemeralRule(rule)
            ? {
                ...rule,
                dormant: rule.expiresAt < now,
                linkedSessions: rule.sessionIds.length,
                anchorText: rule.anchorText.slice(0, 200),
              }
            : rule,
        ),
      });
    },
  );
}
