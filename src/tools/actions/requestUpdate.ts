import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import type { IntentStore, ToolCallRecorder } from "../server.js";

export function createRequestUpdateTool(
  ctx: QueryToolContext,
  intentStore: IntentStore,
  recorder: ToolCallRecorder
) {
  return tool(
    "request_update",
    "Request additional changes to the current active change's worktree. Provide instructions for what to change.",
    {
      instructions: z.string().describe("Instructions for what additional changes to make"),
    },
    async (args) => {
      const activeChange = ctx.session.activeChange;
      if (!activeChange) {
        const errorResult = { error: "No active change in this thread." };
        recorder.record("request_update", args as Record<string, unknown>, errorResult);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(errorResult) }],
          isError: true,
        };
      }

      if (!activeChange.worktree) {
        const errorResult = { error: "No worktree exists for this change." };
        recorder.record("request_update", args as Record<string, unknown>, errorResult);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(errorResult) }],
          isError: true,
        };
      }

      const ref = intentStore.stage({
        type: "update",
        sessionId: ctx.session.sessionId,
        instructions: args.instructions,
      });

      const result = { ref, sessionId: ctx.session.sessionId, instructions: args.instructions };
      recorder.record("request_update", args as Record<string, unknown>, result);

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
