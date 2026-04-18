import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { CronExpressionParser } from "cron-parser";
import type { QueryToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import { resolveChannelId } from "../../slack/channelResolver.js";
import { createJob, type CronJob } from "../../cronJobs.js";
import { isValidTimezone } from "../../timezone.js";
import { logger } from "../../logger.js";
import { errorMessage } from "../../errors.js";
import { humanReadableSchedule } from "../../cronScheduler.js";
import { validateRequiredToolNames, formatRequiredToolNameError } from "../toolNameValidator.js";

export interface CreateScheduledMessageDeps {
  createJob: (params: Parameters<typeof createJob>[0]) => Promise<CronJob>;
}

export const defaultCreateScheduledMessageDeps: CreateScheduledMessageDeps = {
  createJob,
};

export function createCreateScheduledMessageTool(
  ctx: QueryToolContext,
  deps: CreateScheduledMessageDeps = defaultCreateScheduledMessageDeps,
) {
  return tool(
    "create_scheduled_message",
    "Create a scheduled message that runs on a cron schedule. " +
      "Use this when the user asks to schedule recurring messages or one-time future messages. " +
      "If the user's request is ambiguous (e.g., 'send this regularly' without specifying when), " +
      "ask clarifying questions first before calling this tool. " +
      "The cronExpression uses standard 5-field cron syntax (minute hour day-of-month month day-of-week) " +
      "and is interpreted in the timezone you pass as `timezone` — do NOT convert to UTC. " +
      "For example, '0 9 * * *' with timezone 'America/New_York' means 9:00 AM every day in New York. " +
      "Provide a prompt describing what Claude should do each time the schedule fires. " +
      "IMPORTANT: The prompt should only describe WHAT to do, not HOW to deliver the result. " +
      "The scheduler automatically handles delivery via submit_response — do NOT include " +
      "instructions about submit_response, post_to, or how to post the message in the prompt.",
    {
      channel: z
        .string()
        .describe(
          "Channel name (e.g. '#ops' or 'ops'), channel ID (e.g. 'C0123ABCDEF'), " +
            "DM channel ID (e.g. 'D0123ABCDEF'), or your own user ID to DM yourself " +
            "(e.g. 'U0123ABCDEF'). Third-party user IDs are not allowed.",
        ),
      cronExpression: z
        .string()
        .describe(
          "5-field cron expression, interpreted in the `timezone` you pass — do NOT convert to UTC " +
            "(e.g. '0 9 * * *' for daily at 9am in the given timezone, '0 9 * * 1' for Mondays at 9am)",
        ),
      timezone: z
        .string()
        .describe(
          "IANA timezone name the cron expression is expressed in (e.g. 'America/New_York', " +
            "'Europe/London', 'UTC'). Pass the user's local timezone — shown in the system " +
            "prompt as USER TIMEZONE — unless they explicitly asked for a different zone.",
        ),
      prompt: z
        .string()
        .describe("What Claude should do each time (e.g. 'Summarize today's merged PRs')"),
      oneShot: z
        .boolean()
        .optional()
        .describe("If true, the scheduled message fires once and is automatically deleted."),
      requiredTools: z
        .array(z.string())
        .optional()
        .describe(
          "Fully-qualified MCP tool names (e.g. 'mcp__trivia__submit_answers') that MUST be " +
            "called during this run before the final response is delivered. If any listed tool " +
            "is not called, submit_response returns an error and Claude retries. Use when a " +
            "scheduled job has a required side-effect (like submitting answers). " +
            "Omit for normal jobs.",
        ),
      plugin: z
        .string()
        .optional()
        .describe(
          "Name of a loaded Clack plugin this scheduled job is associated with (e.g. 'trivia'). " +
            "When set, the plugin's declared scheduled-run default required tools are " +
            "automatically unioned with `requiredTools` at trigger time. Use this for " +
            "plugin-driven jobs (e.g. trivia) instead of listing the plugin's tools manually.",
        ),
    },
    async (args) => {
      if (!ctx.slackClient) {
        return errorResult("Scheduling requires a Slack connection");
      }

      // Validate cron expression
      try {
        CronExpressionParser.parse(args.cronExpression);
      } catch (error) {
        return errorResult(
          `Invalid cron expression "${args.cronExpression}": ${errorMessage(error)}. Use 5-field format: minute hour day-of-month month day-of-week`,
        );
      }

      if (!isValidTimezone(args.timezone)) {
        return errorResult(
          `Invalid timezone "${args.timezone}". Pass an IANA name like "America/New_York" or "UTC".`,
        );
      }

      // Validate requiredTools names against known clack core tools and loaded plugins.
      if (args.requiredTools && args.requiredTools.length > 0) {
        const err = formatRequiredToolNameError(validateRequiredToolNames(args.requiredTools));
        if (err) return errorResult(err);
      }

      // Resolve channel
      const resolved = await resolveChannelId(
        { client: ctx.slackClient, userId: ctx.userId },
        args.channel,
      );
      if (!resolved.ok) return errorResult(resolved.error);
      const channelId = resolved.channelId;

      try {
        const job = await deps.createJob({
          cronExpression: args.cronExpression,
          channel: channelId,
          prompt: args.prompt,
          createdBy: ctx.userId,
          timezone: args.timezone,
          oneShot: args.oneShot,
          requiredTools: args.requiredTools,
          plugin: args.plugin,
        });

        const schedule = humanReadableSchedule(args.cronExpression, args.timezone);
        const nextRun = getNextRun(args.cronExpression, args.timezone);

        return textResult({
          ok: true,
          id: job.id,
          channel: channelId,
          schedule,
          nextRun,
          type: "dynamic",
          oneShot: args.oneShot ?? false,
        });
      } catch (error) {
        logger.error("Failed to create scheduled message:", error);
        return errorResult(`Failed to create scheduled message: ${errorMessage(error)}`);
      }
    },
  );
}

function getNextRun(cronExpression: string, timezone: string): string {
  try {
    const interval = CronExpressionParser.parse(cronExpression, {
      tz: timezone,
    });
    return interval.next().toDate().toISOString();
  } catch {
    return "unknown";
  }
}
