import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { CronExpressionParser } from "cron-parser";
import type { QueryToolContext } from "../types.js";
import { textResult, errorResult, resolveChannelId } from "../helpers.js";
import { getJob, updateJob } from "../../cronJobs.js";
import { canManageRoles } from "../../permissions.js";
import { humanReadableSchedule } from "../../cronScheduler.js";
import { logger } from "../../logger.js";
import { errorMessage } from "../../errors.js";

export function createUpdateScheduledMessageTool(ctx: QueryToolContext) {
  return tool(
    "update_scheduled_message",
    "Update an existing scheduled message. " +
      "Non-admin users can only update their own scheduled messages. " +
      "Only provide the fields you want to change.",
    {
      id: z.string().describe("The scheduled message ID to update"),
      cronExpression: z.string().optional().describe("New cron expression"),
      channel: z.string().optional().describe("New target channel"),
      prompt: z
        .string()
        .optional()
        .describe(
          "New prompt for dynamic content generation. Should only describe WHAT to do, not HOW to deliver — the scheduler handles delivery automatically.",
        ),
    },
    async (args) => {
      const job = await getJob(args.id);
      if (!job) {
        return errorResult(`Scheduled message "${args.id}" not found.`);
      }

      const isAdmin = canManageRoles(ctx.role);
      if (!isAdmin && job.createdBy !== ctx.userId) {
        return errorResult("You can only update your own scheduled messages.");
      }

      // Validate cron expression if provided
      if (args.cronExpression) {
        try {
          CronExpressionParser.parse(args.cronExpression);
        } catch (error) {
          const msg = errorMessage(error);
          return errorResult(`Invalid cron expression "${args.cronExpression}": ${msg}`);
        }
      }

      // Resolve channel if provided
      let channelId = args.channel;
      if (channelId && ctx.slackClient) {
        const resolved = await resolveChannelId(ctx.slackClient, channelId);
        if (!resolved.ok) return errorResult(resolved.error);
        channelId = resolved.channelId;
      }

      try {
        const updated = await updateJob(args.id, {
          ...(args.cronExpression && { cronExpression: args.cronExpression }),
          ...(channelId && { channel: channelId }),
          ...(args.prompt !== undefined && { prompt: args.prompt }),
        });

        if (!updated) {
          return errorResult("Failed to update scheduled message.");
        }

        const schedule = humanReadableSchedule(updated.cronExpression, updated.timezone);
        return textResult({
          ok: true,
          id: updated.id,
          channel: updated.channel,
          schedule,
          type: updated.prompt ? "dynamic" : "static",
        });
      } catch (error) {
        logger.error("Failed to update scheduled message:", error);
        return errorResult(`Failed to update scheduled message: ${errorMessage(error)}`);
      }
    },
  );
}
