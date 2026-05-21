import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { textResult } from "../helpers.js";
import { getJobs, getJobsByUser, type CronJob } from "../../cronJobs.js";
import { canManageRoles } from "../../permissions.js";
import { humanReadableSchedule } from "../../cronFormatter.js";
import { slackLink } from "../../slack/logContext.js";

export function createListScheduledMessagesTool(ctx: QueryToolContext) {
  return tool(
    "list_scheduled_messages",
    "List scheduled messages. By default lists your own. Admins can use all=true to see all scheduled messages.",
    {
      channel: z.string().optional().describe("Filter by channel name or ID"),
      all: z.boolean().optional().describe("List all scheduled messages (admin/owner only)"),
    },
    async (args) => {
      const isAdmin = canManageRoles(ctx.role);
      let jobs = args.all && isAdmin ? await getJobs() : await getJobsByUser(ctx.userId);

      // Filter by channel if specified
      if (args.channel) {
        const channelFilter = args.channel.replace(/^#/, "");
        jobs = jobs.filter((j) => j.channel === channelFilter || j.channel === args.channel);
      }

      if (jobs.length === 0) {
        return textResult({
          ok: true,
          count: 0,
          message: "No scheduled messages found.",
          scheduled_messages: [],
        });
      }

      const formatted = await Promise.all(
        jobs.map(async (j) => ({
          id: j.id,
          channel: j.channel,
          schedule: humanReadableSchedule(j.cronExpression, j.timezone),
          cronExpression: j.cronExpression,
          prompt: j.prompt,
          enabled: j.enabled,
          oneShot: j.oneShot ?? false,
          createdBy: j.createdBy,
          systemActor: j.systemActor ?? null,
          lastRunAt: j.lastRunAt ?? null,
          lastRunStatus: j.lastRunStatus ?? null,
          requiredTools: j.requiredTools ?? null,
          plugin: j.plugin ?? null,
          skipConditions: j.skipConditions ?? null,
          // When set to "skipped", `lastRunStatus: "skipped"` is the expected terminator behavior —
          // the deliverable is a domain tool (e.g. post_questions for trivia), not submit_response.
          submitResponseMode: j.submitResponseMode ?? null,
          totalRuns: (j.runs ?? []).length,
          recentRuns: await formatRuns(j, ctx),
        })),
      );

      return textResult({
        ok: true,
        count: formatted.length,
        scheduled_messages: formatted,
      });
    },
  );
}

async function formatRuns(job: CronJob, ctx: QueryToolContext) {
  const runs = job.runs ?? [];
  if (runs.length === 0 || !ctx.slackClient) return [];

  const recent = runs.slice(-5);
  return Promise.all(
    recent.map(async (run) => ({
      executedAt: run.executedAt,
      status: run.status,
      ...(run.responseTs
        ? { link: (await slackLink(ctx.slackClient!, job.channel, run.responseTs)).trim() }
        : {}),
    })),
  );
}
