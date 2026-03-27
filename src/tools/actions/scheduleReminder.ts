import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import { logger } from "../../logger.js";

export function createScheduleReminderTool(ctx: QueryToolContext) {
  return tool(
    "schedule_reminder",
    "Schedule a message to be posted to a Slack channel at a future time. " +
    "Use this when the user asks you to set a reminder or schedule a message. " +
    "The post_at parameter must be an ISO 8601 UTC timestamp. " +
    "Messages are limited to 120 days in the future. " +
    "The message will be attributed to the requesting user.",
    {
      channel: z.string().describe("Channel name (e.g. '#ops' or 'ops') or channel ID (e.g. 'C0123ABCDEF')"),
      message: z.string().describe("The reminder message content"),
      post_at: z.string().describe("ISO 8601 UTC timestamp for when to post (e.g. '2026-03-28T15:00:00Z')"),
    },
    async (args) => {
      if (!ctx.slackClient) {
        return errorResult("Scheduling requires a Slack connection");
      }

      // Resolve channel: if it looks like an ID, use directly; otherwise look up by name
      let channelId = args.channel;
      if (!channelId.startsWith("C")) {
        const channelName = channelId.replace(/^#/, "");
        try {
          const listResult = await ctx.slackClient.conversations.list({
            types: "public_channel,private_channel",
            limit: 1000,
          });
          const match = listResult.channels?.find(
            (ch) => ch.name === channelName,
          );
          if (!match?.id) {
            return errorResult(`Could not find channel "${channelName}". Make sure the channel exists and the bot is a member.`);
          }
          channelId = match.id;
        } catch (error) {
          const message = error instanceof Error ? error.message : "unknown error";
          return errorResult(`Failed to resolve channel name: ${message}`);
        }
      }

      // Parse timestamp
      const postAtDate = new Date(args.post_at);
      if (isNaN(postAtDate.getTime())) {
        return errorResult(`Invalid timestamp: "${args.post_at}". Provide a valid ISO 8601 timestamp.`);
      }
      const postAtUnix = Math.floor(postAtDate.getTime() / 1000);

      // Build attributed message
      const attributedText = `🔔 Reminder from <@${ctx.userId}>:\n${args.message}`;

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
        const message = error instanceof Error ? error.message : "unknown error";
        logger.error("Failed to schedule message:", error);

        if (message.includes("time_in_past")) {
          return errorResult("The specified time is in the past. Provide a future timestamp.");
        }
        if (message.includes("time_too_far")) {
          return errorResult("The specified time is more than 120 days in the future. Slack limits scheduled messages to 120 days.");
        }
        if (message.includes("channel_not_found") || message.includes("not_in_channel")) {
          return errorResult("The bot is not a member of the specified channel. Invite the bot first.");
        }

        return errorResult(`Failed to schedule message: ${message}`);
      }
    },
  );
}
