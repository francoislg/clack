import type { App } from "@slack/bolt";
import { logger } from "../../logger.js";
import { processMessage } from "./core.js";

export function registerThreadReplyHandler(app: App): void {
  app.event("message", async ({ event, client }) => {
    // Type guard for message events
    const msg = event as {
      bot_id?: string;
      subtype?: string;
      channel_type?: string;
      channel: string;
      user?: string;
      ts: string;
      text?: string;
      thread_ts?: string;
    };

    // Skip bot messages and subtypes (like message_changed)
    if (msg.bot_id || msg.subtype) {
      return;
    }

    // Only handle thread replies (must have thread_ts different from ts)
    if (!msg.thread_ts || msg.thread_ts === msg.ts) {
      return;
    }

    // Only auto-respond in DMs, not in channels (channels require @mention)
    if (msg.channel_type !== "im") {
      return;
    }

    // Skip if no user
    if (!msg.user) {
      return;
    }

    logger.debug(`Thread reply in ${msg.channel} from ${msg.user}`);

    await processMessage({
      client,
      userId: msg.user,
      channelId: msg.channel,
      messageTs: msg.ts,
      messageText: msg.text || "",
      threadTs: msg.thread_ts,
      triggerType: "directMessages",
    });
  });
}
