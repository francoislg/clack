import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import { resolveChannelId } from "../../slack/channelResolver.js";
import { errorMessage } from "../../errors.js";
import { logger } from "../../logger.js";
import { t } from "../../i18n/t.js";

export function createScheduleReminderTool(ctx: QueryToolContext) {
  return tool(
    "schedule_reminder",
    "Schedule a message to be posted to a Slack channel or DM at a future time. " +
      "Use this when the user asks you to set a reminder or schedule a message. " +
      "The post_at parameter must be an ISO 8601 UTC timestamp — if the user spoke in " +
      "their local time (e.g. 'tomorrow at 3pm'), convert that local time to UTC using " +
      "the USER TIMEZONE from the system prompt before passing it. " +
      "Messages are limited to 120 days in the future. " +
      "The message will be attributed to the requesting user.",
    {
      channel: z
        .string()
        .describe(
          "Channel name (e.g. '#ops' or 'ops'), channel ID (e.g. 'C0123ABCDEF'), " +
            "DM channel ID (e.g. 'D0123ABCDEF'), or your own user ID to DM yourself " +
            "(e.g. 'U0123ABCDEF'). Third-party user IDs are not allowed.",
        ),
      message: z.string().describe("The reminder message content"),
      post_at: z
        .string()
        .describe(
          "ISO 8601 UTC timestamp for when to post (e.g. '2026-03-28T15:00:00Z'). " +
            "Convert the user's local time to UTC before passing.",
        ),
    },
    async (args) => {
      if (!ctx.slackClient) {
        return errorResult("Scheduling requires a Slack connection");
      }

      // Resolve channel
      const resolved = await resolveChannelId(
        { client: ctx.slackClient, userId: ctx.userId },
        args.channel,
      );
      if (!resolved.ok) return errorResult(resolved.error);
      const channelId = resolved.channelId;

      // Parse timestamp
      const postAtDate = new Date(args.post_at);
      if (isNaN(postAtDate.getTime())) {
        return errorResult(
          `Invalid timestamp: "${args.post_at}". Provide a valid ISO 8601 timestamp.`,
        );
      }
      const postAtUnix = Math.floor(postAtDate.getTime() / 1000);

      // Build attributed message
      const attributedText = `${t("reminder.attribution_prefix", { user: `<@${ctx.userId}>` })}\n${args.message}`;

      try {
        const result = await ctx.slackClient.chat.scheduleMessage({
          channel: channelId,
          text: attributedText,
          post_at: postAtUnix,
        });

        return textResult({
          ok: true,
          scheduled_message_id: result.scheduled_message_id,
          channel: channelId,
          post_at: args.post_at,
          message: args.message,
        });
      } catch (error) {
        const message = errorMessage(error);
        logger.error("Failed to schedule message:", error);

        if (message.includes("time_in_past")) {
          return errorResult("The specified time is in the past. Provide a future timestamp.");
        }
        if (message.includes("time_too_far")) {
          return errorResult(
            "The specified time is more than 120 days in the future. Slack limits scheduled messages to 120 days.",
          );
        }
        if (message.includes("channel_not_found") || message.includes("not_in_channel")) {
          return errorResult(
            "Channel not found or bot is not a member. For channels, invite the bot first. " +
              "For DMs, ensure the user ID is correct.",
          );
        }

        return errorResult(`Failed to schedule message: ${message}`);
      }
    },
  );
}
