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
      userFeedback: z
        .string()
        .optional()
        .describe(
          'The verbatim user message that motivated this update (e.g. "you missed file X", "that\'s not what I meant — do Y"). The worker is resuming its prior session and remembers its previous decisions; without seeing the user\'s correction it tends to defend those decisions instead of changing course. Always include this when the update is reacting to user feedback.',
        ),
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
        ...(args.userFeedback && { userFeedback: args.userFeedback }),
      });

      return textResult({
        ref,
        sessionId: ctx.session.sessionId,
        instructions: args.instructions,
        ...(args.userFeedback && { userFeedback: args.userFeedback }),
        applied: false,
        instruction:
          "STAGED — the worker has NOT received these instructions yet. The user must click 'Update' to dispatch them. Your submit_response prose MUST reflect this: use pending language ('I've drafted an update...', 'Click below to send this to the worker'). Do NOT use 'Done', 'I'll update...', 'I've sent...' — those imply work has happened, which it hasn't until the click.",
      });
    },
  );
}
