import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import { getJob, deleteJob } from "../../cronJobs.js";
import { canManageRoles } from "../../permissions.js";
import { logger } from "../../logger.js";
import { errorMessage } from "../../errors.js";

export function createCancelScheduledMessageTool(ctx: QueryToolContext) {
  return tool(
    "cancel_scheduled_message",
    "Cancel (delete) a scheduled message by its ID. " +
    "Non-admin users can only cancel their own scheduled messages. " +
    "Admins can cancel any scheduled message.",
    {
      id: z.string().describe("The scheduled message ID to cancel"),
    },
    async (args) => {
      const job = await getJob(args.id);
      if (!job) {
        return errorResult(`Scheduled message "${args.id}" not found.`);
      }

      // Permission check: non-admins can only cancel their own
      const isAdmin = canManageRoles(ctx.role);
      if (!isAdmin && job.createdBy !== ctx.userId) {
        return errorResult("You can only cancel your own scheduled messages. Ask an admin to cancel this one.");
      }

      try {
        await deleteJob(args.id);
        return textResult({
          ok: true,
          cancelled: true,
          id: args.id,
        });
      } catch (error) {
        logger.error("Failed to cancel scheduled message:", error);
        return errorResult(`Failed to cancel scheduled message: ${errorMessage(error)}`);
      }
    },
  );
}
