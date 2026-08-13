import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import { bootstrapInvestigation } from "../../investigations/engine.js";
import { getOwnerUserId, sendOwnerDm } from "../../slack/ownerDm.js";
import { t } from "../../i18n/t.js";
import { setAttentionLevel } from "../../sessions.js";
import { logger } from "../../logger.js";

export function createStartInvestigationTool(ctx: QueryToolContext) {
  return tool(
    "start_investigation",
    "Start a new investigation by selecting an origin thread (from the current session or a specified thread). Creates a dedicated investigation session in the configured investigations channel or as a DM conversation, adds the origin thread as the first followed thread, and runs the first analysis round. After a successful relocation, ALWAYS acknowledge in the origin thread with the investigation permalink. Relocating the current thread also disengages it (attention off; mentions re-engage).",
    {
      surface: z
        .enum(["channel", "dm"])
        .describe(
          'Investigation surface: "channel" posts to the configured investigations channel; "dm" creates a DM investigation with the requester',
        ),
      thread_ref: z
        .object({
          channel: z.string().describe("Channel ID of the thread"),
          thread_ts: z.string().describe("Thread timestamp (parent message ts)"),
        })
        .optional()
        .describe(
          "Optional origin thread reference. When omitted, uses the current session's channel/thread.",
        ),
      subject: z
        .string()
        .optional()
        .describe("Short subject line to label the investigation (optional)"),
    },
    async (args) => {
      const client = ctx.slackClient;
      if (!client) {
        return errorResult(
          "Slack client not available in this context (required to bootstrap an investigation).",
        );
      }

      const originChannel = args.thread_ref?.channel ?? ctx.session.channelId;
      const originThreadTs = args.thread_ref?.thread_ts ?? ctx.session.threadTs;

      const isCurrentThread =
        originChannel === ctx.session.channelId && originThreadTs === ctx.session.threadTs;

      const result = await bootstrapInvestigation({
        client,
        surface: args.surface,
        originChannel,
        originThreadTs,
        requester: ctx.userId,
        originMode: args.surface === "dm" ? "follow" : "followAndInteract",
        subject: args.subject,
      });

      if (result.status === "ok") {
        let originDisengaged = false;
        if (isCurrentThread) {
          try {
            await setAttentionLevel(ctx.session.sessionId, "off");
            originDisengaged = true;
          } catch (err) {
            logger.warn(
              `startInvestigation: failed to disengage session ${ctx.session.sessionId}: ${String(err)}`,
            );
          }
        }

        return textResult({
          status: "ok",
          sessionId: result.sessionId,
          mainChannel: result.mainChannel,
          ...(result.permalink ? { permalink: result.permalink } : {}),
          degraded: result.degraded,
          ...(originDisengaged ? { originDisengaged: true } : {}),
          ...(originDisengaged
            ? {
                note: "The origin thread has been disengaged (attention off) — passive messages there no longer trigger responses; an @mention re-engages. Acknowledge the relocation in the origin thread with the investigation link.",
              }
            : {}),
        });
      }

      if (result.status === "channel_not_configured") {
        // Mirror the reaction path: DM the owner so they know to configure a channel.
        const ownerUserId = await getOwnerUserId();
        if (ownerUserId) {
          await sendOwnerDm(
            ownerUserId,
            t("investigations.owner_unconfigured", { user: `<@${ctx.userId}>` }),
          );
        }
        return errorResult(
          "The investigations channel is not configured. Tell the requester an admin needs to set it from the Home Tab (the owner has been notified).",
        );
      }

      if (result.status === "cycle") {
        return errorResult("Cannot investigate the investigations channel itself (cycle guard).");
      }

      if (result.status === "duplicate") {
        return textResult({
          status: "duplicate",
          message: "This thread is already being investigated.",
          ...(result.permalink ? { permalink: result.permalink } : {}),
        });
      }

      if (result.status === "dm_failed") {
        return errorResult("Failed to open a DM channel with the requester.");
      }

      return errorResult("Investigation bootstrap failed.");
    },
  );
}
