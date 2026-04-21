import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { CronExpressionParser } from "cron-parser";
import type { QueryToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import { resolveChannelId } from "../../slack/channelResolver.js";
import { getJob, updateJob } from "../../cronJobs.js";
import { canManageRoles } from "../../permissions.js";
import { humanReadableSchedule } from "../../cronScheduler.js";
import { isValidTimezone } from "../../timezone.js";
import { validateRequiredToolNames, formatRequiredToolNameError } from "../toolNameValidator.js";
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
      cronExpression: z
        .string()
        .optional()
        .describe(
          "New cron expression, interpreted in the job's timezone (pass `timezone` here to change it) — do NOT convert to UTC",
        ),
      timezone: z
        .string()
        .optional()
        .describe(
          "New IANA timezone the cron expression is expressed in (e.g. 'America/New_York', 'UTC'). Omit to keep unchanged.",
        ),
      channel: z.string().optional().describe("New target channel"),
      prompt: z
        .string()
        .optional()
        .describe(
          "New prompt for dynamic content generation. Should only describe WHAT to do, not HOW to deliver — the scheduler handles delivery automatically.",
        ),
      requiredTools: z
        .array(z.string())
        .optional()
        .describe(
          "Replace the list of required MCP tool names (e.g. 'mcp__trivia__submit_answers'). " +
            "Pass an empty array to clear the requirement. Omit to leave unchanged.",
        ),
      plugin: z
        .string()
        .optional()
        .describe(
          "Name of a loaded Clack plugin this job is associated with. Pass an empty string " +
            "to clear. Omit to leave unchanged.",
        ),
      skipConditions: z
        .string()
        .optional()
        .describe(
          "Free-form conditions under which this run should skip posting (evaluated by Claude " +
            "at each run). Pass an empty string to clear. Omit to leave unchanged.",
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

      if (args.timezone !== undefined && !isValidTimezone(args.timezone)) {
        return errorResult(
          `Invalid timezone "${args.timezone}". Pass an IANA name like "America/New_York" or "UTC".`,
        );
      }

      // Validate requiredTools names if provided. An empty array clears the requirement and
      // doesn't need validation.
      if (args.requiredTools && args.requiredTools.length > 0) {
        const err = formatRequiredToolNameError(validateRequiredToolNames(args.requiredTools));
        if (err) return errorResult(err);
      }

      // Resolve channel if provided
      let channelId = args.channel;
      if (channelId && ctx.slackClient) {
        const resolved = await resolveChannelId(
          { client: ctx.slackClient, userId: ctx.userId },
          channelId,
        );
        if (!resolved.ok) return errorResult(resolved.error);
        channelId = resolved.channelId;
      }

      try {
        const updated = await updateJob(args.id, {
          ...(args.cronExpression && { cronExpression: args.cronExpression }),
          ...(args.timezone !== undefined && { timezone: args.timezone }),
          ...(channelId && { channel: channelId }),
          ...(args.prompt !== undefined && { prompt: args.prompt }),
          ...(args.requiredTools !== undefined && { requiredTools: args.requiredTools }),
          ...(args.plugin !== undefined && { plugin: args.plugin }),
          ...(args.skipConditions !== undefined && { skipConditions: args.skipConditions }),
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
