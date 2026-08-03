import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { textResult } from "../helpers.js";
import { requireInvestigationSession } from "../investigationSession.js";

export function createListFollowedThreadsTool(ctx: QueryToolContext) {
  return tool(
    "list_followed_threads",
    "List all threads currently followed by the investigation session.",
    {},
    async () => {
      const guard = await requireInvestigationSession(ctx.session.sessionId);
      if (!guard.ok) return guard.error;

      const threads = guard.followedThreads.map((f) => ({
        channel: f.channel,
        threadTs: f.threadTs,
        mode: f.mode,
        pendingCount: f.pendingCount,
        addedBy: f.addedBy,
      }));

      return textResult({
        followedThreads: threads,
        total: threads.length,
      });
    },
  );
}
