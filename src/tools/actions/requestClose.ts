import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { ToolContext } from "../types.js";
import type { IntentStore, ToolCallRecorder } from "../server.js";

export function createRequestCloseTool(
  ctx: ToolContext,
  intentStore: IntentStore,
  recorder: ToolCallRecorder
) {
  return tool(
    "request_close",
    "Request to close the current change session's PR and clean up the worktree.",
    {
      _placeholder: z.boolean().optional().describe("Unused parameter"),
    },
    async () => {
      const session = ctx.changeSession;
      if (!session) {
        const errorResult = { error: "No active change session in this thread." };
        recorder.record("request_close", {}, errorResult);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(errorResult) }],
          isError: true,
        };
      }

      if (!session.prUrl) {
        const errorResult = { error: "No PR has been created for this change session yet." };
        recorder.record("request_close", {}, errorResult);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(errorResult) }],
          isError: true,
        };
      }

      const ref = intentStore.stage({
        type: "close",
        sessionId: session.id,
        prUrl: session.prUrl,
      });

      const result = { ref, sessionId: session.id, prUrl: session.prUrl };
      recorder.record("request_close", {}, result);

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
