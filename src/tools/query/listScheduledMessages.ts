import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { textResult } from "../helpers.js";
import { getJobs, getJobsByUser, type CronJob } from "../../cronJobs.js";
import { canManageRoles } from "../../permissions.js";
import { humanReadableSchedule } from "../../cronFormatter.js";
import { slackLink } from "../../slack/logContext.js";

/**
 * Max characters of a job's `prompt` returned in the list response. Plugin-managed prompts
 * (e.g. casual-talk, trivia) routinely exceed 50KB, so emitting full prompts here can blow the
 * per-tool result size cap when many jobs match. Callers that need the full prompt use
 * `get_scheduled_message(id)`.
 */
const PROMPT_PREVIEW_CHARS = 200;

export function createListScheduledMessagesTool(ctx: QueryToolContext) {
  return tool(
    "list_scheduled_messages",
    "List scheduled messages. By default lists your own; admins can pass `all=true` to see every job. " +
      "Narrow further with `channel` (id or name; channelless plugin-managed jobs are excluded by this filter) " +
      "or `plugin` (e.g. `plugin: 'casual-talk'`) — pass these whenever the list might be large " +
      "instead of fetching everything and grepping. " +
      "Each row's `prompt` is truncated to ~200 chars and flagged with `prompt_truncated: true`; " +
      "call `get_scheduled_message(id)` for the full prompt and details.",
    {
      channel: z.string().optional().describe("Filter by channel name or ID"),
      all: z.boolean().optional().describe("List all scheduled messages (admin/owner only)"),
      plugin: z
        .string()
        .optional()
        .describe(
          "Filter to scheduled messages owned by this plugin (matches the job's `plugin` field, plugin-managed jobs only). " +
            "Use this to find a plugin's channelless cron job — channel-based filtering misses those.",
        ),
    },
    async (args) => {
      const isAdmin = canManageRoles(ctx.role);
      let jobs = args.all && isAdmin ? await getJobs() : await getJobsByUser(ctx.userId);

      // Filter by channel if specified
      if (args.channel) {
        const channelFilter = args.channel.replace(/^#/, "");
        jobs = jobs.filter((j) => j.channel === channelFilter || j.channel === args.channel);
      }

      // Filter by plugin owner if specified
      if (args.plugin) {
        jobs = jobs.filter((j) => j.plugin === args.plugin && j.pluginManaged === true);
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
        jobs.map(async (j) => {
          const truncated = j.prompt.length > PROMPT_PREVIEW_CHARS;
          return {
            id: j.id,
            channel: j.channel,
            schedule: humanReadableSchedule(j.cronExpression, j.timezone),
            cronExpression: j.cronExpression,
            prompt: truncated ? j.prompt.slice(0, PROMPT_PREVIEW_CHARS) + "…" : j.prompt,
            promptTruncated: truncated,
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
          };
        }),
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
      // Channelless jobs (no `job.channel`) can't render a deep-link from job alone.
      ...(run.responseTs && job.channel
        ? { link: (await slackLink(ctx.slackClient!, job.channel, run.responseTs)).trim() }
        : {}),
    })),
  );
}
