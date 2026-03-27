import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import { logger } from "../../logger.js";

export function createListRemindersTool(ctx: QueryToolContext) {
  return tool(
    "list_reminders",
    "List all pending scheduled messages. " +
    "Returns messages scheduled by this bot that haven't been posted yet. " +
    "Optionally filter by channel.",
    {
      channel: z.string().optional().describe("Channel ID to filter by (optional)"),
    },
    async (args) => {
      if (!ctx.slackClient) {
        return errorResult("Listing reminders requires a Slack connection");
      }

      try {
        const listArgs: { channel?: string } = {};
        if (args.channel) {
          listArgs.channel = args.channel;
        }

        const result = await ctx.slackClient.chat.scheduledMessages.list(listArgs);

        const messages = (result.scheduled_messages ?? []).map((msg) => ({
          id: msg.id,
          channel_id: msg.channel_id,
          post_at: new Date((msg.post_at as number) * 1000).toISOString(),
          date_created: msg.date_created
            ? new Date((msg.date_created as number) * 1000).toISOString()
            : undefined,
          text: msg.text,
        }));

        return textResult({
          ok: true,
          count: messages.length,
          scheduled_messages: messages,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        logger.error("Failed to list scheduled messages:", error);
        return errorResult(`Failed to list scheduled messages: ${message}`);
      }
    },
  );
}
