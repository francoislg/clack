import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import { getActiveChangeForUser, type ActiveChangeState } from "../../changes/activeState.js";
import { canEditConfig } from "../../permissions.js";
import type { UserRole } from "../../roles.js";
import { logger } from "../../logger.js";

export interface CancelWorkerRunDeps {
  getActiveChangeForUser: (
    userId: string,
  ) => { sessionId: string; change: ActiveChangeState } | undefined;
  canEditConfig: (role: UserRole) => boolean;
}

export const defaultCancelWorkerRunDeps: CancelWorkerRunDeps = {
  getActiveChangeForUser,
  canEditConfig,
};

export function createCancelWorkerRunTool(
  ctx: QueryToolContext,
  deps: CancelWorkerRunDeps = defaultCancelWorkerRunDeps,
) {
  return tool(
    "cancel_worker_run",
    "Cancel a running change execution. " +
      "Aborts the in-flight Claude worker if it is currently running (executing, reviewing, or merging). " +
      "By default cancels your own run. Admins and owners can cancel another user's run by specifying target_user_id.",
    {
      target_user_id: z
        .string()
        .optional()
        .describe(
          "Slack user ID of the user whose run to cancel. Omit to cancel your own. Requires admin/owner role.",
        ),
      reason: z.string().optional().describe("Optional reason for cancellation"),
    },
    async (args) => {
      const targetUserId = args.target_user_id ?? ctx.userId;

      // Permission check: only admin/owner can cancel other users' runs
      if (targetUserId !== ctx.userId && !deps.canEditConfig(ctx.role)) {
        return errorResult("Only admins and owners can cancel other users' worker runs.");
      }

      const active = deps.getActiveChangeForUser(targetUserId);
      if (!active) {
        return errorResult(
          targetUserId === ctx.userId
            ? "No active worker run found. You may not have a change currently executing, reviewing, or merging."
            : `No active worker run found for user <@${targetUserId}>.`,
        );
      }

      const { sessionId, change } = active;
      const description = `${change.repo}:${change.branch} (${change.status})`;

      // Set cancelledBy BEFORE aborting so workflow.ts can detect it
      change.cancelledBy = { userId: ctx.userId, reason: args.reason };

      if (change.abortController) {
        change.abortController.abort();
        logger.info(
          `Worker run cancelled by ${ctx.userId}: ${description}${args.reason ? ` — ${args.reason}` : ""}`,
        );
        return textResult({
          ok: true,
          cancelled: true,
          sessionId,
          description,
          message: "Worker run aborted. The execution will stop shortly.",
        });
      }

      // No AbortController — worker process is gone (e.g., after restart) but
      // the session is still in an active status.
      logger.info(
        `Stale worker run flagged by ${ctx.userId}: ${description}${args.reason ? ` — ${args.reason}` : ""}`,
      );
      return errorResult(
        "No running worker process found — the session may have been lost after a restart.",
      );
    },
  );
}
