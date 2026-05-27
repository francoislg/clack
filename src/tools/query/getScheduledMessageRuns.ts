import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import { getJob } from "../../cronJobs.js";
import { canManageRoles } from "../../permissions.js";
import { slackLink } from "../../slack/logContext.js";

export function createGetScheduledMessageRunsTool(ctx: QueryToolContext) {
  return tool(
    "get_scheduled_message_runs",
    "Get the full run history for a scheduled message. Use this when you need more than the last 5 runs returned by list_scheduled_messages. " +
      'Interpreting `status: "skipped"`: if the response carries `submitResponseMode: "skipped"`, ' +
      "every skipped run is an *expected* terminator-skip — the job's deliverable is a domain tool " +
      "(e.g. post_questions for trivia), not submit_response. Treat those skipped rows as successful runs. " +
      "Without that field, `skipped` means skipConditions or skipDates matched and the job posted nothing.",
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

      const skippedIsExpected = job.submitResponseMode === "skipped";
      const meta = {
        ...(job.submitResponseMode ? { submitResponseMode: job.submitResponseMode } : {}),
        ...(skippedIsExpected
          ? {
              note:
                "This job uses submitResponseMode:'skipped'. Runs with status:'skipped' are the " +
                "designed terminator behavior — the job delivers via its domain tool (e.g. post_questions). " +
                "Treat them as successful runs, not failures or no-ops.",
            }
          : {}),
      };

      const runs = job.runs ?? [];
      if (runs.length === 0 || !ctx.slackClient) {
        return textResult({ ok: true, id: job.id, count: 0, runs: [], ...meta });
      }

      const formatted = await Promise.all(
        runs.map(async (run) => ({
          executedAt: run.executedAt,
          status: run.status,
          // Channelless jobs (no `job.channel`) can't render a Slack deep-link from the
          // job alone — the responseTs is from a `post_to` call whose channel isn't
          // recorded on the run today. Skip the link in that case.
          ...(run.responseTs && job.channel
            ? { link: (await slackLink(ctx.slackClient!, job.channel, run.responseTs)).trim() }
            : {}),
        })),
      );

      return textResult({
        ok: true,
        id: job.id,
        count: formatted.length,
        runs: formatted,
        ...meta,
      });
    },
  );
}
