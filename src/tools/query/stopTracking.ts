import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import type { SessionContext } from "../../sessions.js";
import { textResult, errorResult } from "../helpers.js";
import { parseSlackMessageUrl } from "./fetchSlackMessage.js";
import { findSessionByThread, setAutoResponseActive } from "../../sessions.js";
import { canEditConfig } from "../../permissions.js";
import type { UserRole } from "../../roles.js";

export interface StopTrackingDeps {
  findSession: (channelId: string, threadTs: string) => Promise<SessionContext | null>;
  setActive: (sessionId: string, active: boolean) => Promise<void>;
  isAdmin: (role: UserRole) => boolean;
}

const defaultDeps: StopTrackingDeps = {
  findSession: findSessionByThread,
  setActive: setAutoResponseActive,
  isAdmin: canEditConfig,
};

export function createStopTrackingTool(
  ctx: QueryToolContext,
  deps: StopTrackingDeps = defaultDeps,
) {
  return tool(
    "stop_tracking",
    "Stop auto-respond tracking for a thread. Clack will no longer evaluate messages in the thread until re-mentioned. Use when a user asks to stop tracking a specific thread by URL.",
    {
      url: z.string().describe("Slack message URL of the thread to stop tracking"),
    },
    async (args) => {
      const parsed = parseSlackMessageUrl(args.url);
      if (!parsed) {
        return errorResult("Invalid Slack message URL format");
      }

      // Use threadTs if present (URL points to a reply), otherwise messageTs is the thread root
      const threadTs = parsed.threadTs ?? parsed.messageTs;
      const session = await deps.findSession(parsed.channelId, threadTs);
      if (!session) {
        return errorResult("No tracked session found for that thread");
      }

      // Permission check: session owner or admin+
      if (session.userId !== ctx.userId && !deps.isAdmin(ctx.role)) {
        return errorResult("You can only stop tracking threads you started, or ask an admin");
      }

      // Idempotent: already disengaged is a success
      if (session.autoResponseActive === false) {
        return textResult({
          success: true,
          channel: parsed.channelId,
          thread_ts: threadTs,
          session_id: session.sessionId,
          already_disengaged: true,
        });
      }

      await deps.setActive(session.sessionId, false);

      return textResult({
        success: true,
        channel: parsed.channelId,
        thread_ts: threadTs,
        session_id: session.sessionId,
      });
    },
  );
}
