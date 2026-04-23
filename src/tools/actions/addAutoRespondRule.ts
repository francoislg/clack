import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import { addRule } from "../../autoRespond.js";
import { resolveChannelId, type ResolveChannelResult } from "../../slack/channelResolver.js";
import { logger } from "../../logger.js";
import { errorMessage } from "../../errors.js";

export interface AddAutoRespondRuleDeps {
  resolveChannel: (input: string) => Promise<ResolveChannelResult>;
  addRule: typeof addRule;
}

export function createAddAutoRespondRuleTool(
  ctx: QueryToolContext,
  depsOverride?: Partial<AddAutoRespondRuleDeps>,
) {
  const deps: AddAutoRespondRuleDeps = {
    resolveChannel: (input: string) => {
      if (!ctx.slackClient) {
        return Promise.resolve({
          ok: false,
          error: "Auto-respond rule management requires a Slack connection",
        });
      }
      return resolveChannelId({ client: ctx.slackClient, userId: ctx.userId }, input);
    },
    addRule,
    ...depsOverride,
  };

  return tool(
    "add_auto_respond_rule",
    "Create a new auto-respond rule (admin-only). Channels can be names ('#ops', 'ops'), " +
      "channel IDs ('C0123...'), or DM IDs ('D0123...'); each is resolved to a canonical " +
      "channel ID before persisting. The rule is created with enabled=true. " +
      "If the request is ambiguous (e.g., user says 'add a rule for engineering' without " +
      "specifying which channel, keywords, or user filters), ask clarifying questions before " +
      "calling this tool. Prefer calling list_auto_respond_rules first when the user references " +
      "'an existing rule'.",
    {
      channels: z
        .array(z.string())
        .min(1)
        .describe("One or more channel names, channel IDs, or DM IDs. Must not be empty."),
      userFilters: z
        .array(z.string())
        .optional()
        .describe(
          "Optional Slack user IDs (e.g. 'U0123...'). When set, the rule only triggers for messages from these users (OR-combined with keywords).",
        ),
      keywords: z
        .array(z.string())
        .optional()
        .describe(
          "Optional keywords (case-insensitive substring match). When set, the rule triggers if the message contains any keyword (OR-combined with userFilters).",
        ),
      extraContext: z
        .string()
        .optional()
        .describe(
          "Optional free-form context prepended to the message text when the rule fires. Useful for steering the response ('This is a Sentry error — summarize and suggest a fix').",
        ),
      preAnalysisContext: z
        .string()
        .optional()
        .describe(
          "Optional pre-analysis context. When set, a lightweight Claude Haiku call evaluates message relevance before responding. Leave empty to skip pre-analysis (default).",
        ),
    },
    async (args) => {
      const results = await Promise.all(args.channels.map((entry) => deps.resolveChannel(entry)));
      const resolvedChannels: string[] = [];
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (!result.ok) {
          return errorResult(`Failed to resolve channel "${args.channels[i]}": ${result.error}`);
        }
        resolvedChannels.push(result.channelId);
      }

      try {
        const rule = await deps.addRule(
          resolvedChannels,
          args.userFilters,
          args.keywords,
          args.extraContext,
          args.preAnalysisContext,
        );
        return textResult({
          ok: true,
          id: rule.id,
          channels: rule.channels,
          enabled: rule.enabled,
        });
      } catch (error) {
        logger.error("Failed to add auto-respond rule:", error);
        return errorResult(`Failed to add auto-respond rule: ${errorMessage(error)}`);
      }
    },
  );
}
