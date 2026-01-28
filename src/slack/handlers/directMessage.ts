import type { App } from "@slack/bolt";
import { logger } from "../../logger.js";
import { processMessage } from "./core.js";

export function registerDirectMessageHandler(app: App): void {
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

    // Only handle DMs (im channel type)
    if (msg.channel_type !== "im") {
      return;
    }

    // Skip thread replies - handled by threadReply handler
    if (msg.thread_ts && msg.thread_ts !== msg.ts) {
      return;
    }

    // Skip if no user (shouldn't happen, but type safety)
    if (!msg.user || !msg.text) {
      return;
    }

    logger.debug(`DM from ${msg.user}`);

    await processMessage({
      client,
      userId: msg.user,
      channelId: msg.channel,
      messageTs: msg.ts,
      messageText: msg.text,
      threadTs: undefined, // New message, no thread
      triggerType: "directMessages",
    });
  });
}
