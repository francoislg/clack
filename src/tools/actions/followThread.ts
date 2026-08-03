import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import { updateSession } from "../../sessions.js";
import { getInvestigationsChannel, addFollowedThread } from "../../investigations/state.js";
import type { FollowedThread } from "../../investigations/types.js";
import { requireInvestigationSession } from "../investigationSession.js";

export function createFollowThreadTool(ctx: QueryToolContext) {
  return tool(
    "follow_thread",
    "Add a thread to the current investigation session's followed-thread list. The thread will be drained on the next investigation round and its updates injected into the investigation's context.",
    {
      channel: z.string().describe("Channel ID of the thread to follow"),
      thread_ts: z.string().describe("Thread timestamp (parent message ts) to follow"),
      mode: z
        .enum(["follow", "followAndInteract"])
        .describe(
          'Follow mode: "follow" only monitors for new messages; "followAndInteract" also triggers analysis on relevant activity',
        ),
    },
    async (args) => {
      const guard = await requireInvestigationSession(ctx.session.sessionId);
      if (!guard.ok) return guard.error;
      const { session, followedThreads } = guard;

      // Guard: reject threads in the investigations channel (cycle guard)
      const investigationsChannel = getInvestigationsChannel();
      if (investigationsChannel && args.channel === investigationsChannel) {
        return errorResult(
          "Cannot follow threads in the investigations channel itself (cycle guard).",
        );
      }

      // Guard: reject already-followed threads
      const alreadyFollowing = followedThreads.some(
        (f) => f.channel === args.channel && f.threadTs === args.thread_ts,
      );
      if (alreadyFollowing) {
        return errorResult(`This thread is already being followed in this investigation.`);
      }

      // Add to session's followedThreads
      const newFollowedThread: FollowedThread = {
        channel: args.channel,
        threadTs: args.thread_ts,
        mode: args.mode,
        lastInjectedTs: "0",
        pendingCount: 0,
        addedBy: ctx.userId,
      };

      const updated = await updateSession(session.sessionId, {
        followedThreads: [...followedThreads, newFollowedThread],
      });

      if (!updated) {
        return errorResult("Failed to update the investigation session.");
      }

      // Index in the routing state
      await addFollowedThread(session.sessionId, args.channel, args.thread_ts);

      return textResult({
        status: "ok",
        message: `Thread added to investigation in ${args.mode} mode.`,
        channel: args.channel,
        threadTs: args.thread_ts,
        mode: args.mode,
      });
    },
  );
}
