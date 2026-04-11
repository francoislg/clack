import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { CronExpressionParser } from "cron-parser";
import type { App } from "@slack/bolt";
import type { QueryToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import { resolveChannelId } from "../../slack/channelResolver.js";
import { createJob, type CronJob } from "../../cronJobs.js";
import { getUserInfo, type UserInfo } from "../../slack/userCache.js";
import { logger } from "../../logger.js";
import { errorMessage } from "../../errors.js";
import { humanReadableSchedule } from "../../cronScheduler.js";

export interface CreateScheduledMessageDeps {
  getUserInfo: (client: App["client"], userId: string) => Promise<UserInfo | undefined>;
  createJob: (params: Parameters<typeof createJob>[0]) => Promise<CronJob>;
}

export const defaultCreateScheduledMessageDeps: CreateScheduledMessageDeps = {
  getUserInfo,
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
      "The cronExpression uses standard 5-field cron syntax (minute hour day-of-month month day-of-week). " +
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
          "5-field cron expression (e.g. '0 9 * * *' for daily at 9am, '0 9 * * 1' for Mondays at 9am)",
        ),
      prompt: z
        .string()
        .describe("What Claude should do each time (e.g. 'Summarize today's merged PRs')"),
      oneShot: z
        .boolean()
        .optional()
        .describe("If true, the scheduled message fires once and is automatically deleted."),
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

      // Resolve channel
      const resolved = await resolveChannelId(
        { client: ctx.slackClient, userId: ctx.userId },
        args.channel,
      );
      if (!resolved.ok) return errorResult(resolved.error);
      const channelId = resolved.channelId;

      // Get creator's timezone
      const userInfo = await deps.getUserInfo(ctx.slackClient, ctx.userId);
      const timezone = userInfo?.tz ?? "UTC";

      try {
        const job = await deps.createJob({
          cronExpression: args.cronExpression,
          channel: channelId,
          prompt: args.prompt,
          createdBy: ctx.userId,
          timezone,
          oneShot: args.oneShot,
        });

        const schedule = humanReadableSchedule(args.cronExpression, timezone);
        const nextRun = getNextRun(args.cronExpression, timezone);

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
    const interval = CronExpressionParser.parse(cronExpression, { tz: timezone });
    return interval.next().toDate().toISOString();
  } catch {
    return "unknown";
  }
}
