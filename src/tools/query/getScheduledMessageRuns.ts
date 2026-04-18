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
    "Get the full run history for a scheduled message. Use this when you need more than the last 5 runs returned by list_scheduled_messages.",
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

      const runs = job.runs ?? [];
      if (runs.length === 0 || !ctx.slackClient) {
        return textResult({ ok: true, id: job.id, count: 0, runs: [] });
      }

      const formatted = await Promise.all(
        runs.map(async (run) => ({
          executedAt: run.executedAt,
          status: run.status,
          ...(run.responseTs
            ? { link: (await slackLink(ctx.slackClient!, job.channel, run.responseTs)).trim() }
            : {}),
        })),
      );

      return textResult({ ok: true, id: job.id, count: formatted.length, runs: formatted });
    },
  );
}
