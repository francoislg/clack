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
    "Create a scheduled message that runs on a recurring schedule. " +
      "Use this when the user asks to schedule recurring messages or one-time future messages. " +
      "If the user's request is ambiguous (e.g., 'send this regularly' without specifying when), " +
      "ask clarifying questions first before calling this tool. " +
      "Time is specified with `minute` and `hour` as the user's LOCAL clock time in the " +
      "`timezone` you pass — pass exactly what the user said (e.g. user said '11:30 AM' → " +
      "hour: 11, minute: 30). The tool interprets those in the given timezone. Do NOT convert " +
      "to UTC. Provide a prompt describing what Claude should do each time the schedule fires. " +
      "IMPORTANT: The prompt should only describe WHAT to do, not HOW to deliver the result. " +
      "The scheduler automatically handles delivery via submit_response — do NOT include " +
      "instructions about submit_response, post_to, or how to post the message in the prompt. " +
      "When reporting back to the user, quote the `schedule` field from the tool result verbatim " +
      "(e.g. 'Every day at 11:30 AM EDT') — do not recompute or rephrase it.",
    {
      channel: z
        .string()
        .describe(
          "Channel name (e.g. '#ops' or 'ops'), channel ID (e.g. 'C0123ABCDEF'), " +
            "DM channel ID (e.g. 'D0123ABCDEF'), or your own user ID to DM yourself " +
            "(e.g. 'U0123ABCDEF'). Third-party user IDs are not allowed.",
        ),
      minute: z
        .number()
        .int()
        .min(0)
        .max(59)
        .describe("Minute of the hour (0-59) in the user's local timezone. NOT UTC."),
      hour: z
        .number()
        .int()
        .min(0)
        .max(23)
        .describe(
          "Hour of the day (0-23) in the user's local timezone — the exact hour the user said. " +
            "NOT UTC. E.g. user said '11:30 AM' → hour: 11. User said '3pm' → hour: 15.",
        ),
      dayOfMonth: z
        .string()
        .describe(
          "Cron day-of-month field: '*' for every day, '1' for the 1st, '1,15' for 1st and 15th, etc.",
        ),
      month: z
        .string()
        .describe(
          "Cron month field: '*' for every month, '1' for January, '1-6' for Jan-Jun, etc.",
        ),
      dayOfWeek: z
        .string()
        .describe(
          "Cron day-of-week field: '*' for every day, '1-5' for Mon-Fri (weekdays), " +
            "'1' for Mondays, '0,6' for weekends (Sun, Sat).",
        ),
      timezone: z
        .string()
        .describe(
          "IANA timezone name the hour/minute are expressed in (e.g. 'America/New_York', " +
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
      skipConditions: z
        .string()
        .optional()
        .describe(
          "Free-form operator-supplied conditions under which this run should skip posting. " +
            "When set, Claude evaluates these before doing anything else at each run and may " +
            "call `submit_response` with `skip_response: true` to decline delivery. Useful when " +
            "the scheduled task's relevance depends on external state (e.g., 'Skip if no PRs " +
            "were merged in the last 24 hours.'). Written in plain language; evaluated by Claude.",
        ),
    },
    async (args) => {
      if (!ctx.slackClient) {
        return errorResult("Scheduling requires a Slack connection");
      }

      const cronExpression = `${args.minute} ${args.hour} ${args.dayOfMonth} ${args.month} ${args.dayOfWeek}`;

      try {
        CronExpressionParser.parse(cronExpression);
      } catch (error) {
        return errorResult(
          `Invalid schedule fields (built cron "${cronExpression}"): ${errorMessage(error)}. ` +
            "Check dayOfMonth, month, and dayOfWeek for valid cron syntax (use '*' for every).",
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
          cronExpression,
          channel: channelId,
          prompt: args.prompt,
          createdBy: ctx.userId,
          timezone: args.timezone,
          oneShot: args.oneShot,
          requiredTools: args.requiredTools,
          plugin: args.plugin,
          skipConditions: args.skipConditions,
        });

        const schedule = humanReadableSchedule(cronExpression, args.timezone);
        const nextRun = getNextRun(cronExpression, args.timezone);

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
