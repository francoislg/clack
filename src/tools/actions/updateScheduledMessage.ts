import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { CronExpressionParser } from "cron-parser";
import type { QueryToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import { resolveChannelId } from "../../slack/channelResolver.js";
import { getJob, updateJob } from "../../cronJobs.js";
import { canManageRoles } from "../../permissions.js";
import { humanReadableSchedule } from "../../cronFormatter.js";
import { isValidTimezone } from "../../timezone.js";
import { validateRequiredToolNames, formatRequiredToolNameError } from "../toolNameValidator.js";
import { logger } from "../../logger.js";
import { errorMessage } from "../../errors.js";

export function createUpdateScheduledMessageTool(ctx: QueryToolContext) {
  return tool(
    "update_scheduled_message",
    "Update an existing scheduled message. " +
      "Non-admin users can only update their own scheduled messages. " +
      "Only provide the fields you want to change. " +
      "To change the schedule time, pass the full `schedule` object with all five cron fields — " +
      "hour/minute are in the stored (or newly-passed) timezone, NOT UTC. " +
      "When reporting back to the user, quote the `schedule` field from the tool result verbatim " +
      "— do not recompute or rephrase it.",
    {
      id: z.string().describe("The scheduled message ID to update"),
      schedule: z
        .object({
          minute: z
            .string()
            .describe(
              "Cron minute field in the job's timezone (NOT UTC). Accepts any cron syntax: " +
                "'30', '0,30', '0-15', '*/15' (every 15 min), or '*' (every minute).",
            ),
          hour: z
            .string()
            .describe(
              "Cron hour field in the job's timezone (NOT UTC). Accepts any cron syntax: '9', " +
                "'9,13,17', '9-17', '*/2' (every 2 hours), or '*' (every hour).",
            ),
          dayOfMonth: z.string().describe("Cron day-of-month field (e.g. '*', '1', '1,15')."),
          month: z.string().describe("Cron month field (e.g. '*', '1', '1-6')."),
          dayOfWeek: z
            .string()
            .describe("Cron day-of-week field (e.g. '*', '1-5' for weekdays, '0,6' for weekends)."),
        })
        .optional()
        .describe(
          "Replace the full schedule. Omit to keep the existing one. All five fields are required when provided.",
        ),
      timezone: z
        .string()
        .optional()
        .describe(
          "New IANA timezone the hour/minute are expressed in (e.g. 'America/New_York', 'UTC'). Omit to keep unchanged.",
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
            "Pass an empty array `[]` to clear all requirements. Omit this field entirely to leave " +
            "the existing list unchanged. These two are different — `[]` is destructive.",
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
      name: z
        .string()
        .max(80)
        .optional()
        .describe(
          "New short descriptive label for the schedule (up to 80 chars). Surfaced in the Home " +
            "Tab and in task cards. Omit to leave the existing name unchanged. Pass an empty " +
            "string to clear it. Pass a non-empty string to replace it.",
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

      // Plugin-managed jobs are reconciled from plugin config; only the runtime `enabled`
      // flag is admin-overridable. Toggling enabled goes through the Home Tab, not this tool.
      if (job.pluginManaged) {
        return errorResult(
          `Scheduled message "${args.id}" is managed by plugin "${job.plugin ?? "unknown"}" — ` +
            "its content (schedule, prompt, channel, timezone, requiredTools, skipConditions) is reconciled " +
            "from the plugin's config block on every reload. To change it, edit the plugin's section in " +
            "data/config.json. Pausing/resuming is available from the Home Tab.",
        );
      }

      let newCronExpression: string | undefined;
      if (args.schedule) {
        const { minute, hour, dayOfMonth, month, dayOfWeek } = args.schedule;
        newCronExpression = `${minute} ${hour} ${dayOfMonth} ${month} ${dayOfWeek}`;
        try {
          CronExpressionParser.parse(newCronExpression);
        } catch (error) {
          const msg = errorMessage(error);
          return errorResult(
            `Invalid schedule fields (built cron "${newCronExpression}"): ${msg}. ` +
              "All five fields accept standard cron syntax (use '*' for every, '*/N' for steps, " +
              "'A,B' for lists, 'A-B' for ranges).",
          );
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
          ...(newCronExpression && { cronExpression: newCronExpression }),
          ...(args.timezone !== undefined && { timezone: args.timezone }),
          ...(channelId && { channel: channelId }),
          ...(args.prompt !== undefined && { prompt: args.prompt }),
          ...(args.requiredTools !== undefined && { requiredTools: args.requiredTools }),
          ...(args.plugin !== undefined && { plugin: args.plugin }),
          ...(args.skipConditions !== undefined && { skipConditions: args.skipConditions }),
          ...(args.name !== undefined && { name: args.name }),
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
