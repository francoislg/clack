import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { textResult } from "../helpers.js";
import { getJobs, type CronJob } from "../../cronJobs.js";
import { humanReadableSchedule } from "../../cronFormatter.js";
import { slackLink } from "../../slack/logContext.js";
import { canViewFull, isPrivateTarget, type Viewer } from "../cronJobAccess.js";
import { buildRedactedJobRow, type RedactedJobRow } from "../redactedJobProjection.js";

/**
 * Max characters of a job's `prompt` returned in the list response. Plugin-managed prompts
 * (e.g. casual-talk, trivia) routinely exceed 50KB, so emitting full prompts here can blow the
 * per-tool result size cap when many jobs match. Callers that need the full prompt use
 * `get_scheduled_message(id)`.
 */
const PROMPT_PREVIEW_CHARS = 200;

interface FormattedRunInfo {
  executedAt: string;
  status: "success" | "error" | "skipped";
  link?: string;
}

interface FullJobRow {
  id: string;
  name: string | undefined;
  channel: string | undefined;
  schedule: string;
  cronExpression: string;
  prompt: string;
  promptTruncated: boolean;
  enabled: boolean;
  oneShot: boolean;
  createdBy: string | null;
  systemActor: string | undefined;
  lastRunAt: string | null;
  lastRunStatus: "success" | "error" | "skipped" | null;
  requiredTools: string[] | null;
  plugin: string | null;
  skipConditions: string | null;
  submitResponseMode: string | null;
  attentionLevel: string | null;
  editableByAnyone: boolean;
  totalRuns: number;
  recentRuns: FormattedRunInfo[];
}

type FormattedJobRow = FullJobRow | RedactedJobRow;

export function createListScheduledMessagesTool(ctx: QueryToolContext) {
  return tool(
    "list_scheduled_messages",
    "List scheduled messages. " +
      "Scope: all channel-targeted jobs are listed for everyone; rows marked `redacted: true` " +
      "belong to other users—only identity/schedule metadata is shown. Only the job's creator or " +
      "an admin can view full content or make changes (except `editableByAnyone: true` jobs, which " +
      "are fully shown and editable by anyone). DM-targeted and personal (channelless, non-plugin) " +
      "jobs appear only for their creator and admins. " +
      "When you reference an ambiguous automation in a channel, use this list to disambiguate by " +
      "name/owner/schedule. " +
      "Filters `channel` and `plugin` always narrow within the chosen scope—pass them whenever " +
      "the list might be large instead of fetching everything and grepping. " +
      "Redacted rows show only identity/schedule; call `get_scheduled_message(id)` for the full " +
      "prompt and details (restricted to owners and admins).",
    {
      channel: z.string().optional().describe("Filter by channel name or ID"),
      plugin: z
        .string()
        .optional()
        .describe(
          "Filter to scheduled messages owned by this plugin (matches the job's `plugin` field, plugin-managed jobs only). " +
            "Use this to find a plugin's channelless cron job — channel-based filtering misses those.",
        ),
    },
    async (args) => {
      const viewer: Viewer = {
        userId: ctx.userId,
        role: ctx.role,
      };

      // Start from ALL jobs
      const allJobs = await getJobs();

      // Filter: drop private-target jobs the viewer can't see
      let jobs = allJobs.filter((j) => !isPrivateTarget(j) || canViewFull(j, viewer));

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

      const formatted = await Promise.all(jobs.map((j) => formatJobRow(j, viewer, ctx)));

      return textResult({
        ok: true,
        count: formatted.length,
        scheduled_messages: formatted,
      });
    },
  );
}

/**
 * Format a job row: full projection when canViewFull, else redacted projection.
 */
async function formatJobRow(
  job: CronJob,
  viewer: Viewer,
  ctx: QueryToolContext,
): Promise<FormattedJobRow> {
  if (canViewFull(job, viewer)) {
    // Full projection: all existing fields plus editableByAnyone
    const truncated = job.prompt.length > PROMPT_PREVIEW_CHARS;
    return {
      id: job.id,
      name: job.name,
      channel: job.channel,
      schedule: humanReadableSchedule(job.cronExpression, job.timezone),
      cronExpression: job.cronExpression,
      prompt: truncated ? job.prompt.slice(0, PROMPT_PREVIEW_CHARS) + "…" : job.prompt,
      promptTruncated: truncated,
      enabled: job.enabled,
      oneShot: job.oneShot ?? false,
      createdBy: job.createdBy,
      systemActor: job.systemActor,
      lastRunAt: job.lastRunAt ?? null,
      lastRunStatus: job.lastRunStatus ?? null,
      requiredTools: job.requiredTools ?? null,
      plugin: job.plugin ?? null,
      skipConditions: job.skipConditions ?? null,
      submitResponseMode: job.submitResponseMode ?? null,
      attentionLevel: job.attentionLevel ?? null,
      editableByAnyone: job.editableByAnyone ?? false,
      totalRuns: (job.runs ?? []).length,
      recentRuns: await formatRuns(job, ctx),
    };
  }

  return buildRedactedJobRow(job);
}

async function formatRuns(job: CronJob, ctx: QueryToolContext): Promise<FormattedRunInfo[]> {
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
