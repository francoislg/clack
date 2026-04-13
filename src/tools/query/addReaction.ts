import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import { resolveReactionTarget } from "./reactionHelpers.js";

export function createAddReactionTool(ctx: QueryToolContext) {
  return tool(
    "add_reaction",
    "Add an emoji reaction to a Slack message. Provide either a Slack message URL or channel_id + message_ts to identify the message.",
    {
      emoji: z.string().describe("Emoji name without colons (e.g. 'thumbsup', 'white_check_mark')"),
      url: z.string().optional().describe("Slack message URL"),
      channel_id: z.string().optional().describe("Channel ID (use with message_ts)"),
      message_ts: z.string().optional().describe("Message timestamp (use with channel_id)"),
    },
    async (args) => {
      if (!ctx.slackClient) {
        return errorResult("Slack client is not available in this context");
      }

      const target = resolveReactionTarget(args);
      if ("error" in target) return errorResult(target.error);

      try {
        await ctx.slackClient.reactions.add({
          channel: target.channel,
          timestamp: target.timestamp,
          name: args.emoji,
        });
        return textResult({
          success: true,
          emoji: args.emoji,
          channel: target.channel,
          message_ts: target.timestamp,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("already_reacted")) {
          return textResult({
            success: true,
            emoji: args.emoji,
            already_reacted: true,
          });
        }
        if (msg.includes("invalid_name")) {
          return errorResult(`Invalid emoji name: "${args.emoji}"`);
        }
        if (msg.includes("message_not_found")) {
          return errorResult("Message not found");
        }
        if (msg.includes("channel_not_found")) {
          return errorResult("Channel not found");
        }
        return errorResult(`Failed to add reaction: ${msg}`);
      }
    },
  );
}
