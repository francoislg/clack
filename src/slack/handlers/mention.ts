import type { App } from "@slack/bolt";
import { logger } from "../../logger.js";
import { extractAttachments } from "../fileExtractor.js";
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

    if (!messageText && !event.thread_ts) {
      // No message content and not in a thread — nothing to work with
      await client.chat.postMessage({
        channel: event.channel,
        thread_ts: event.ts,
        text: "Hi! Please include a question when mentioning me, or tag me in a thread and I'll read the conversation.",
      });
      return;
    }

    const attachments = extractAttachments((event as unknown as { files?: unknown[] }).files);

    await processMessage({
      client,
      userId: event.user,
      channelId: event.channel,
      messageTs: event.ts,
      messageText: messageText || "Read the conversation above and provide an answer or investigation based on what's being discussed.",
      threadTs: event.thread_ts,
      triggerType: "mentions",
      ...attachments,
    });
  });
}
