import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import { getJob, deleteJob } from "../../cronJobs.js";
import { logger } from "../../logger.js";
import { errorMessage } from "../../errors.js";
import { humanReadableSchedule } from "../../cronFormatter.js";
import { canViewFull, canDelete, isPrivateTarget, type Viewer } from "../cronJobAccess.js";

export function createCancelScheduledMessageTool(ctx: QueryToolContext) {
  return tool(
    "cancel_scheduled_message",
    "Cancel (PERMANENTLY DELETE) a scheduled message by its ID. " +
      "This action is irreversible. Use this only when the user explicitly says delete/cancel/remove. " +
      "When the user says 'turn off', 'stop', or 'pause', use update_scheduled_message with enabled: false instead (recoverable). " +
      "Before cancelling in a channel that hosts more than one scheduled job, list them and confirm the target by job NAME and owner — never act on an ambiguous 'this automation'. " +
      "Non-admins can only cancel their own scheduled messages. Shared (editableByAnyone) jobs are still delete-restricted to owner/admin.",
    {
      id: z.string().describe("The scheduled message ID to cancel"),
    },
    async (args) => {
      const job = await getJob(args.id);
      if (!job) {
        return errorResult(`Scheduled message "${args.id}" not found.`);
      }

      const viewer: Viewer = { userId: ctx.userId, role: ctx.role };

      // Private targets stay private to their creator. Non-owners see "not found".
      if (isPrivateTarget(job) && !canViewFull(job, viewer)) {
        return errorResult(`Scheduled message "${args.id}" not found.`);
      }

      // Plugin-managed jobs are created and removed by the plugin's reconcile loop. Cancelling
      // them through this tool would leave the config out of sync; the job would reappear on the
      // next reload. Removal goes through editing the plugin's config block.
      if (job.pluginManaged) {
        return errorResult(
          `Scheduled message "${args.id}" is managed by plugin "${job.plugin ?? "unknown"}" — ` +
            "it cannot be cancelled through this tool. Remove the matching entry from the plugin's " +
            "section in data/config.json instead.",
        );
      }

      // Permission check: only owner or admin can cancel
      if (!canDelete(job, viewer)) {
        const creatorMention = job.createdBy ? `<@${job.createdBy}>` : "the owner";
        if (job.editableByAnyone === true) {
          return errorResult(
            `This is a shared schedule — anyone can edit or disable it, but only ${creatorMention} or an admin can cancel it. ` +
              "To stop it recoverably, use update_scheduled_message with enabled: false.",
          );
        }
        return errorResult(
          `You can only cancel your own scheduled messages. Ask ${creatorMention} or an admin to cancel this one.`,
        );
      }

      try {
        await deleteJob(args.id);
        const schedule = humanReadableSchedule(job.cronExpression, job.timezone);
        return textResult({
          ok: true,
          cancelled: true,
          id: args.id,
          name: job.name ?? null,
          channel: job.channel ?? null,
          schedule,
          createdBy: job.createdBy,
        });
      } catch (error) {
        logger.error("Failed to cancel scheduled message:", error);
        return errorResult(`Failed to cancel scheduled message: ${errorMessage(error)}`);
      }
    },
  );
}
