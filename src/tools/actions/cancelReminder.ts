import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import { logger } from "../../logger.js";

export function createCancelReminderTool(ctx: QueryToolContext) {
  return tool(
    "cancel_reminder",
    "Cancel a pending scheduled message before it is posted. " +
      "Requires the scheduled_message_id (from schedule_reminder or list_reminders) and the channel.",
    {
      channel: z.string().describe("Channel ID where the message is scheduled"),
      scheduled_message_id: z.string().describe("The scheduled message ID to cancel"),
    },
    async (args) => {
      if (!ctx.slackClient) {
        return errorResult("Cancelling reminders requires a Slack connection");
      }

      try {
        await ctx.slackClient.chat.deleteScheduledMessage({
          channel: args.channel,
          scheduled_message_id: args.scheduled_message_id,
        });

        return textResult({
          ok: true,
          cancelled: true,
          scheduled_message_id: args.scheduled_message_id,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        logger.error("Failed to cancel scheduled message:", error);

        if (message.includes("invalid_scheduled_message_id")) {
          return errorResult(
            "The scheduled message was not found — it may have already been posted or cancelled.",
          );
        }

        return errorResult(`Failed to cancel scheduled message: ${message}`);
      }
    },
  );
}
