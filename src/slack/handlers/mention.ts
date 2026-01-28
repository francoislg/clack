import type { App } from "@slack/bolt";
import { logger } from "../../logger.js";
import { processMessage } from "./core.js";

export function registerMentionHandler(app: App): void {
  app.event("app_mention", async ({ event, client }) => {
    // Skip if no user (shouldn't happen for app_mention)
    if (!event.user) {
      return;
    }

    logger.debug(`App mention from ${event.user} in ${event.channel}`);

    // Remove the bot mention from the text
    const botId = (await client.auth.test()).user_id;
    const messageText = event.text.replace(new RegExp(`<@${botId}>\\s*`, "g"), "").trim();

    if (!messageText) {
      // No actual message content, just a mention
      await client.chat.postMessage({
        channel: event.channel,
        thread_ts: event.thread_ts || event.ts,
        text: "Hi! Please include a question when mentioning me.",
      });
      return;
    }

    await processMessage({
      client,
      userId: event.user,
      channelId: event.channel,
      messageTs: event.ts,
      messageText,
      threadTs: event.thread_ts,
      triggerType: "mentions",
    });
  });
}
