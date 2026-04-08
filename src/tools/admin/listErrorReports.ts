import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult } from "../helpers.js";
import { listErrorReports } from "../../errorReports.js";

export function createListErrorReportsTool() {
  return tool(
    "admin_list_error_reports",
    "List available error reports from failed Claude queries. Reports include stderr output, conversation traces, and error analysis. Most recent reports are listed first.",
    {
      limit: z.number().optional().describe("Maximum number of reports to return (default: 20)"),
    },
    async ({ limit = 20 }) => {
      const files = await listErrorReports();

      if (files.length === 0) {
        return textResult({ message: "No error reports found", reports: [] });
      }

      const reports = files.slice(0, limit).map((filename) => {
        // Parse session ID and timestamp from filename: {sessionId}-{timestamp}.json
        const match = filename.match(/^(.+)-(\d+)\.json$/);
        const sessionId = match?.[1] ?? filename;
        const timestamp = match?.[2] ? Number(match[2]) : undefined;
        return {
          filename,
          sessionId,
          timestamp,
          date: timestamp ? new Date(timestamp).toISOString() : undefined,
        };
      });

      return textResult({
        total: files.length,
        showing: reports.length,
        reports,
      });
    },
  );
}
