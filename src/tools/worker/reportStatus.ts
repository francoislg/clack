import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { App } from "@slack/bolt";
import type { WorkerToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import { getSlackClient } from "../../slack/app.js";
import { errorMessage } from "../../errors.js";

export interface ReportStatusDeps {
  getSlackClient: () => App["client"] | null;
}

export const defaultReportStatusDeps: ReportStatusDeps = {
  getSlackClient,
};

export function createReportStatusTool(
  ctx: WorkerToolContext,
  deps: ReportStatusDeps = defaultReportStatusDeps,
) {
  return tool(
    "report_status",
    "Post a status message to the Slack thread for this change. Use this to report progress, completion, or errors.",
    {
      message: z.string().describe("The message to post to the Slack thread"),
    },
    async (args) => {
      try {
        const client = deps.getSlackClient();

        if (!client) {
          return errorResult("Slack client not available");
        }

        await client.chat.postMessage({
          channel: ctx.channelId,
          thread_ts: ctx.threadTs,
          text: args.message,
        });

        return textResult({ success: true });
      } catch (error) {
        return errorResult(`slack error: ${errorMessage(error)}`);
      }
    },
  );
}
