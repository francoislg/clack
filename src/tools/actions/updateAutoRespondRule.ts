import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import { updateRule, type AutoRespondRulePatch } from "../../autoRespond.js";
import { resolveChannelId, type ResolveChannelResult } from "../../slack/channelResolver.js";
import { logger } from "../../logger.js";
import { errorMessage } from "../../errors.js";

export interface UpdateAutoRespondRuleDeps {
  resolveChannel: (input: string) => Promise<ResolveChannelResult>;
  updateRule: typeof updateRule;
}

export function createUpdateAutoRespondRuleTool(
  ctx: QueryToolContext,
  depsOverride?: Partial<UpdateAutoRespondRuleDeps>,
) {
  const deps: UpdateAutoRespondRuleDeps = {
    resolveChannel: (input: string) => {
      if (!ctx.slackClient) {
        return Promise.resolve({
          ok: false,
          error: "Auto-respond rule management requires a Slack connection",
        });
      }
      return resolveChannelId({ client: ctx.slackClient, userId: ctx.userId }, input);
    },
    updateRule,
    ...depsOverride,
  };

  return tool(
    "update_auto_respond_rule",
    "Update an existing auto-respond rule (admin-only) with partial-patch semantics. " +
      "Fields omitted from the call are PRESERVED. Pass an empty string to clear extraContext " +
      "or preAnalysisContext; pass an empty array to clear keywords or userFilters. " +
      "Channels are re-resolved via name/ID when supplied. " +
      "If the user's intent is unclear (e.g., 'update the eng rule' with no specifics), " +
      "call list_auto_respond_rules first and confirm which rule and which fields to change.",
    {
      id: z.string().describe("The rule ID to update"),
      channels: z
        .array(z.string())
        .optional()
        .describe("Replace the rule's channels. Accepts names, IDs, or DM IDs. Omit to preserve."),
      userFilters: z
        .array(z.string())
        .optional()
        .describe("Replace userFilters. Pass an empty array to clear. Omit to preserve."),
      keywords: z
        .array(z.string())
        .optional()
        .describe("Replace keywords. Pass an empty array to clear. Omit to preserve."),
      extraContext: z
        .string()
        .optional()
        .describe("Replace extraContext. Pass an empty string to clear. Omit to preserve."),
      preAnalysisContext: z
        .string()
        .optional()
        .describe("Replace preAnalysisContext. Pass an empty string to clear. Omit to preserve."),
      attentionLevel: z
        .enum(["always", "high", "medium", "low", ""])
        .optional()
        .describe(
          "Set the attention level for sessions this rule creates (always | high | medium | low). " +
            'Pass an empty string "" to clear it (reverts to the "medium" default). Omit to preserve.',
        ),
    },
    async (args) => {
      const patch: AutoRespondRulePatch = {};

      if (args.channels !== undefined) {
        if (args.channels.length === 0) {
          return errorResult("channels cannot be empty — a rule must target at least one channel");
        }
        const results = await Promise.all(args.channels.map((entry) => deps.resolveChannel(entry)));
        const resolved: string[] = [];
        for (let i = 0; i < results.length; i++) {
          const r = results[i];
          if (!r.ok) {
            return errorResult(`Failed to resolve channel "${args.channels[i]}": ${r.error}`);
          }
          resolved.push(r.channelId);
        }
        patch.channels = resolved;
      }

      if (args.userFilters !== undefined) patch.userFilters = args.userFilters;
      if (args.keywords !== undefined) patch.keywords = args.keywords;
      if (args.extraContext !== undefined) patch.extraContext = args.extraContext;
      if (args.preAnalysisContext !== undefined) {
        patch.preAnalysisContext = args.preAnalysisContext;
      }
      if (args.attentionLevel !== undefined) patch.attentionLevel = args.attentionLevel;

      try {
        const updated = await deps.updateRule(args.id, patch);
        if (!updated) {
          return errorResult(`Auto-respond rule "${args.id}" not found.`);
        }
        return textResult({
          ok: true,
          id: updated.id,
          channels: updated.channels,
          enabled: updated.enabled,
        });
      } catch (error) {
        logger.error("Failed to update auto-respond rule:", error);
        return errorResult(`Failed to update auto-respond rule: ${errorMessage(error)}`);
      }
    },
  );
}
