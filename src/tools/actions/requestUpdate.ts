import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import type { IntentStore } from "../server.js";
import { textResult, errorResult } from "../helpers.js";

export function createRequestUpdateTool(ctx: QueryToolContext, intentStore: IntentStore) {
  return tool(
    "request_update",
    "Request additional changes to the current active change's worktree. Provide instructions for what to change.",
    {
      instructions: z.string().describe("Instructions for what additional changes to make"),
    },
    async (args) => {
      const activeChange = ctx.session.activeChange;
      if (!activeChange) {
        return errorResult("No active change in this thread.");
      }

      if (!activeChange.worktree) {
        return errorResult("No worktree exists for this change.");
      }

      const ref = intentStore.stage({
        type: "update",
        sessionId: ctx.session.sessionId,
        instructions: args.instructions,
      });

      return textResult({ ref, sessionId: ctx.session.sessionId, instructions: args.instructions });
    },
  );
}
