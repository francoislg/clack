import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult } from "../helpers.js";
import type { QueryToolContext } from "../types.js";
import { readErrorReport } from "../../errorReports.js";
import {
  buildAttributionDeps,
  resolveErrorReportAttribution,
  type ErrorReportAttributionDeps,
} from "./errorReportAttribution.js";

export function createReadErrorReportTool(
  ctx: QueryToolContext,
  depsOverride?: ErrorReportAttributionDeps,
) {
  const deps = depsOverride ?? buildAttributionDeps(ctx.slackClient);

  return tool(
    "admin_read_error_report",
    "Read a specific error report. Contains the full conversation trace, stderr output from the Claude Code process, and error analysis. Use admin_list_error_reports to find available reports. The result carries the `channelId`, `userId`, and `messageLink` of the session that failed — render those as Slack links when you report them, never as bare names.",
    {
      filename: z.string().describe("The report filename from list_error_reports"),
    },
    async ({ filename }) => {
      // Prevent path traversal
      if (filename.includes("..") || filename.includes("/")) {
        return textResult({ error: "Invalid filename" });
      }

      const report = await readErrorReport(filename);
      if (!report) {
        return textResult({ error: `Report not found: ${filename}` });
      }

      return textResult({
        ...report,
        ...(await resolveErrorReportAttribution(report.sessionId, deps)),
      });
    },
  );
}
