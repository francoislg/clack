import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { textResult } from "../helpers.js";
import { closeInvestigation } from "../../investigations/state.js";
import { requireInvestigationSession } from "../investigationSession.js";

export function createCloseInvestigationTool(ctx: QueryToolContext) {
  return tool(
    "close_investigation",
    "Close the current investigation session. Stops monitoring followed threads and removes the investigation from the open investigations index. The session and its history remain on disk.",
    {},
    async () => {
      const guard = await requireInvestigationSession(ctx.session.sessionId);
      if (!guard.ok) return guard.error;
      const { session } = guard;

      await closeInvestigation(session.sessionId);

      return textResult({
        status: "ok",
        message: "Investigation closed. Followed threads are no longer monitored.",
        sessionId: session.sessionId,
      });
    },
  );
}
