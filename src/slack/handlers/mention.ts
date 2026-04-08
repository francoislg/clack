import type { App } from "@slack/bolt";
import { getConfig } from "../../config.js";
import { logger } from "../../logger.js";
import { resolveChannelLabel, resolveUserLabel, slackLink } from "../logContext.js";
import { extractAttachments } from "../fileExtractor.js";
import { processMessage } from "./core.js";
import { findSessionByThread, setAutoResponseActive } from "../../sessions.js";

export interface MentionDeps {
  getConfig: typeof getConfig;
  processMessage: typeof processMessage;
  findSessionByThread: typeof findSessionByThread;
  setAutoResponseActive: typeof setAutoResponseActive;
}

export const defaultMentionDeps: MentionDeps = {
  getConfig,
  processMessage,
  findSessionByThread,
  setAutoResponseActive,
};

export function registerMentionHandler(app: App, deps: MentionDeps = defaultMentionDeps): void {
  app.event("app_mention", async ({ event, client }) => {
    if (!deps.getConfig().mentions.enabled) return;

    // Skip if no user (shouldn't happen for app_mention)
    if (!event.user) {
      return;
    }

    const userLabel = await resolveUserLabel(client, event.user);
    const channelLabel = await resolveChannelLabel(client, event.channel);
    logger.debug(
      `App mention from ${userLabel} in ${channelLabel}${await slackLink(client, event.channel, event.thread_ts ?? event.ts)}`,
    );

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

    // Re-activate auto-respond tracking if the thread was disengaged
    if (event.thread_ts) {
      const existingSession = await deps.findSessionByThread(event.channel, event.thread_ts);
      if (existingSession?.autoResponseActive === false) {
        logger.info(
          `Re-activating auto-respond for session ${existingSession.sessionId}${await slackLink(client, event.channel, event.thread_ts)}`,
        );
        await deps.setAutoResponseActive(existingSession.sessionId, true);
      }
    }

    const attachments = extractAttachments((event as unknown as { files?: unknown[] }).files);

    await deps.processMessage({
      client,
      userId: event.user,
      channelId: event.channel,
      messageTs: event.ts,
      messageText:
        messageText ||
        "Read the conversation above and provide an answer or investigation based on what's being discussed.",
      threadTs: event.thread_ts,
      triggerType: "mentions",
      ...attachments,
    });
  });
}
