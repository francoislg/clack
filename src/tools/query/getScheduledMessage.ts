import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import { getJob, type CronJob } from "../../cronJobs.js";
import { canManageRoles } from "../../permissions.js";
import { humanReadableSchedule } from "../../cronFormatter.js";
import { slackLink } from "../../slack/logContext.js";

export function createGetScheduledMessageTool(ctx: QueryToolContext) {
  return tool(
    "get_scheduled_message",
    "Get the full record of a single scheduled message by id, including the untruncated `prompt`. " +
      "Use this after `list_scheduled_messages` when you need the full prompt or details that the " +
      "list view truncates. Returns the same fields as a list row plus `prompt` (full), `name`, " +
      "`timezone`, `createdAt`, `oneShot`, `pluginManaged`, `specKey`, `attachedTopics`, `skipDates`, " +
      "and the last 5 runs. For the full run history, use `get_scheduled_message_runs`.",
    {
      id: z.string().describe("The scheduled message ID"),
    },
    async (args) => {
      const job = await getJob(args.id);
      if (!job) {
        return errorResult(`Scheduled message "${args.id}" not found.`);
      }

      const isAdmin = canManageRoles(ctx.role);
      if (!isAdmin && job.createdBy !== ctx.userId) {
        return errorResult("You can only view your own scheduled messages.");
      }

      return textResult({
        ok: true,
        id: job.id,
        name: job.name ?? null,
        channel: job.channel,
        schedule: humanReadableSchedule(job.cronExpression, job.timezone),
        cronExpression: job.cronExpression,
        timezone: job.timezone,
        prompt: job.prompt,
        enabled: job.enabled,
        oneShot: job.oneShot ?? false,
        createdBy: job.createdBy,
        systemActor: job.systemActor ?? null,
        createdAt: job.createdAt,
        lastRunAt: job.lastRunAt ?? null,
        lastRunStatus: job.lastRunStatus ?? null,
        requiredTools: job.requiredTools ?? null,
        plugin: job.plugin ?? null,
        pluginManaged: job.pluginManaged ?? false,
        specKey: job.specKey ?? null,
        attachedTopics: job.attachedTopics ?? null,
        skipConditions: job.skipConditions ?? null,
        skipDates: job.skipDates ?? null,
        submitResponseMode: job.submitResponseMode ?? null,
        totalRuns: (job.runs ?? []).length,
        recentRuns: await formatRecentRuns(job, ctx),
      });
    },
  );
}

async function formatRecentRuns(job: CronJob, ctx: QueryToolContext) {
  const runs = job.runs ?? [];
  if (runs.length === 0 || !ctx.slackClient) return [];

  const recent = runs.slice(-5);
  return Promise.all(
    recent.map(async (run) => ({
      executedAt: run.executedAt,
      status: run.status,
      // Channelless jobs (no `job.channel`) can't render a deep-link from job alone.
      ...(run.responseTs && job.channel
        ? { link: (await slackLink(ctx.slackClient!, job.channel, run.responseTs)).trim() }
        : {}),
    })),
  );
}
