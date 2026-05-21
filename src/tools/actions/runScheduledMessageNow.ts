import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import { getJob, type CronJob } from "../../cronJobs.js";
import { canManageRoles } from "../../permissions.js";
import { runJobNow, type JobOutcome } from "../../cronScheduler.js";
import { logger } from "../../logger.js";
import { errorMessage } from "../../errors.js";
import type { App } from "@slack/bolt";

export interface RunScheduledMessageNowDeps {
  runJobNow: (job: CronJob, client: App["client"], asOf?: Date) => Promise<JobOutcome>;
  chatDelete: (params: { channel: string; ts: string }) => Promise<void>;
}

export function createRunScheduledMessageNowTool(
  ctx: QueryToolContext,
  depsOverride?: Partial<RunScheduledMessageNowDeps>,
) {
  // Safe: only registered when slackClient is present (see server.ts).
  const client = ctx.slackClient!;

  const deps: RunScheduledMessageNowDeps = {
    runJobNow,
    chatDelete: (params) => client.chat.delete(params).then(() => undefined),
    ...depsOverride,
  };

  return tool(
    "run_scheduled_message_now",
    "Retry, re-run, or replay an existing dynamic scheduled message on demand. " +
      "Reach for this whenever a user asks to retry a failed scheduled run, re-fire a job ad-hoc, " +
      "or replay a past run with a back-dated date context. " +
      "Three modes: (1) plain run-now with just `id` re-fires the job using the current wall-clock time; " +
      "(2) retry/replay with `asOf` re-fires but instructs Claude to reason about dates as if the run had " +
      "happened at the `asOf` ISO timestamp — use this to retry a failed run by passing the " +
      "original run's `executedAt` (read it from `get_scheduled_message_runs`); " +
      "(3) replace with `replaceResponseTs` deletes a prior bot post in the job's channel before firing — " +
      "the supplied ts must match a `responseTs` from this job's run history. " +
      "Permissions: the job's creator OR an admin can run a scheduled message; other users cannot. " +
      "Limits: tool calls during the run use real wall-clock time (you must translate relative date " +
      "phrases to absolute dates anchored on `asOf`); `skipConditions` evaluate against present-time state, " +
      "so a replay may post when the original skipped or vice versa. " +
      "Interpreting `skipped: true`: it can mean three different things. " +
      '(a) The job declares `submitResponseMode: "skipped"` (plugin-managed jobs like trivia question fires) — ' +
      "the result also carries `expectedSkip: true`, meaning the deliverable was the job's domain tool (e.g. " +
      "`post_questions`) and skipping `submit_response` is the designed terminator behavior, NOT a failure. " +
      "Report the run as successful. " +
      "(b) `skipConditions` matched at runtime — Claude decided not to post. " +
      "(c) A `skipDates` entry matched (off-day). Without `expectedSkip: true`, treat `skipped: true` as a real skip.",
    {
      id: z.string().describe("The scheduled message ID to run."),
      asOf: z
        .string()
        .optional()
        .describe(
          "ISO 8601 datetime to treat as the effective current date for this run. " +
            "When set, Claude reasons about relative date language and filters as if the run fired at this time. " +
            "Omit for a plain run-now using wall-clock time.",
        ),
      replaceResponseTs: z
        .string()
        .optional()
        .describe(
          "Slack message timestamp of a prior bot post (from this job's run history) to delete before firing. " +
            "Must match one of the job's `runs[].responseTs` values; otherwise the call is rejected.",
        ),
    },
    async (args) => {
      const job = await getJob(args.id);
      if (!job) {
        return errorResult(`Scheduled message "${args.id}" not found.`);
      }

      const isAdmin = canManageRoles(ctx.role);
      if (!isAdmin && job.createdBy !== ctx.userId) {
        return errorResult(
          "You can only run your own scheduled messages. Ask an admin to run this one.",
        );
      }

      if (!job.prompt) {
        return errorResult(
          "On-demand execution is only supported for dynamic (prompt-based) scheduled messages. " +
            "Static messages cannot be re-fired this way.",
        );
      }

      let asOfDate: Date | undefined;
      if (args.asOf) {
        const parsed = new Date(args.asOf);
        if (Number.isNaN(parsed.getTime())) {
          return errorResult(`Invalid asOf: "${args.asOf}" is not a parseable ISO 8601 datetime.`);
        }
        asOfDate = parsed;
      }

      let replacedPriorPost = false;
      let replaceError: string | undefined;
      if (args.replaceResponseTs) {
        const owned = (job.runs ?? []).some((r) => r.responseTs === args.replaceResponseTs);
        if (!owned) {
          return errorResult(
            `replaceResponseTs "${args.replaceResponseTs}" does not match any run in this job's history. ` +
              "Only messages this job posted can be replaced.",
          );
        }
        try {
          await deps.chatDelete({ channel: job.channel, ts: args.replaceResponseTs });
          replacedPriorPost = true;
        } catch (err) {
          replaceError = errorMessage(err);
          logger.warn(
            `run_scheduled_message_now: chat.delete failed for ts=${args.replaceResponseTs}: ${replaceError}`,
          );
        }
      }

      let outcome: JobOutcome;
      try {
        outcome = await deps.runJobNow(job, client, asOfDate);
      } catch (err) {
        logger.error("run_scheduled_message_now: runJobNow failed:", err);
        return errorResult(`Failed to run scheduled message: ${errorMessage(err)}`);
      }

      const expectedSkip = outcome.skipped && job.submitResponseMode === "skipped";

      return textResult({
        ok: true,
        id: job.id,
        ...(args.asOf ? { asOf: args.asOf } : {}),
        skipped: outcome.skipped,
        ...(expectedSkip
          ? {
              expectedSkip: true,
              note:
                "This job is configured with submitResponseMode:'skipped' — its actual deliverable " +
                "is a domain tool (e.g. post_questions for trivia), and skipping submit_response is " +
                "the designed terminator behavior. The run completed normally.",
            }
          : {}),
        ...(outcome.responseTs ? { responseTs: outcome.responseTs } : {}),
        ...(args.replaceResponseTs
          ? {
              replacedPriorPost,
              ...(replaceError ? { replaceError } : {}),
            }
          : {}),
      });
    },
  );
}
