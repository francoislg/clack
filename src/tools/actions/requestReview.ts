import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import type { IntentStore, ToolCallRecorder } from "../server.js";

export function createRequestReviewTool(
  ctx: QueryToolContext,
  intentStore: IntentStore,
  recorder: ToolCallRecorder
) {
  return tool(
    "request_review",
    "Request a review of the current change session's PR. Address PR feedback comments and push updates.",
    {
      _placeholder: z.boolean().optional().describe("Unused parameter"),
    },
    async () => {
      const session = ctx.changeSession;
      if (!session) {
        const errorResult = { error: "No active change session in this thread." };
        recorder.record("request_review", {}, errorResult);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(errorResult) }],
          isError: true,
        };
      }

      if (!session.prUrl) {
        const errorResult = { error: "No PR has been created for this change session yet." };
        recorder.record("request_review", {}, errorResult);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(errorResult) }],
          isError: true,
        };
      }

      const ref = intentStore.stage({
        type: "review",
        sessionId: session.id,
        prUrl: session.prUrl,
      });

      const result = { ref, sessionId: session.id, prUrl: session.prUrl };
      recorder.record("request_review", {}, result);

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
