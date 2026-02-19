import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { WorkerToolContext } from "../types.js";

export function createReportStatusTool(ctx: WorkerToolContext) {
  return tool(
    "report_status",
    "Post a status message to the Slack thread for this change. Use this to report progress, completion, or errors.",
    {
      message: z.string().describe("The message to post to the Slack thread"),
    },
    async (args) => {
      try {
        const { getSlackClient } = await import("../../slack/app.js");
        const client = getSlackClient();

        if (!client) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({ success: false, error: "Slack client not available" }),
            }],
            isError: true,
          };
        }

        await client.chat.postMessage({
          channel: ctx.channelId,
          thread_ts: ctx.threadTs,
          text: args.message,
        });

        return {
          content: [{ type: "text" as const, text: JSON.stringify({ success: true }) }],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ success: false, error: "slack error", details: errorMessage }),
          }],
          isError: true,
        };
      }
    }
  );
}
