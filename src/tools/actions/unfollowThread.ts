import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import { updateSession } from "../../sessions.js";
import { removeFollowedThread } from "../../investigations/state.js";
import { requireInvestigationSession } from "../investigationSession.js";

export function createUnfollowThreadTool(ctx: QueryToolContext) {
  return tool(
    "unfollow_thread",
    "Remove a thread from the current investigation session's followed-thread list. The thread will no longer be monitored or drained.",
    {
      channel: z.string().describe("Channel ID of the thread to unfollow"),
      thread_ts: z.string().describe("Thread timestamp (parent message ts) to unfollow"),
    },
    async (args) => {
      const guard = await requireInvestigationSession(ctx.session.sessionId);
      if (!guard.ok) return guard.error;
      const { session, followedThreads } = guard;

      const found = followedThreads.some(
        (f) => f.channel === args.channel && f.threadTs === args.thread_ts,
      );

      if (!found) {
        return errorResult("This thread is not currently being followed in this investigation.");
      }

      const nextFollowedThreads = followedThreads.filter(
        (f) => !(f.channel === args.channel && f.threadTs === args.thread_ts),
      );

      const updated = await updateSession(session.sessionId, {
        followedThreads: nextFollowedThreads.length > 0 ? nextFollowedThreads : undefined,
      });

      if (!updated) {
        return errorResult("Failed to update the investigation session.");
      }

      await removeFollowedThread(args.channel, args.thread_ts);

      return textResult({
        status: "ok",
        message: "Thread removed from investigation.",
        channel: args.channel,
        threadTs: args.thread_ts,
      });
    },
  );
}
