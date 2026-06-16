import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { App } from "@slack/bolt";
import type { WorkerToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import { getSlackClient } from "../../slack/app.js";
import { unfurlOptions } from "../../slack/unfurlOptions.js";
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
      suppress_unfurls: z
        .boolean()
        .optional()
        .describe(
          "Set to true to disable Slack link and image previews on this status message. " +
            "Default behavior previews links — useful for PRs, dashboards, etc.",
        ),
    },
    async (args) => {
      try {
        // Silent change runs (e.g. the idler's "none" tick mode) suppress all Slack output. The
        // status is still useful to Claude, so acknowledge success without posting.
        if (ctx.silent) {
          return textResult({ success: true, posted: false });
        }

        const client = deps.getSlackClient();

        if (!client) {
          return errorResult("Slack client not available");
        }

        await client.chat.postMessage({
          channel: ctx.channelId,
          thread_ts: ctx.threadTs,
          text: args.message,
          ...unfurlOptions(args.suppress_unfurls),
        });

        return textResult({ success: true });
      } catch (error) {
        return errorResult(`slack error: ${errorMessage(error)}`);
      }
    },
  );
}
