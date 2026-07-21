import type { App } from "@slack/bolt";
import { getConfig } from "../../config.js";
import { logger } from "../../logger.js";
import { t } from "../../i18n/t.js";
import { resolveChannelLabel, resolveUserLabel, slackLink } from "../logContext.js";
import { extractAttachments } from "../fileExtractor.js";
import { processMessage } from "./core.js";
import { findSessionByThread, setAttentionLevel, isEngaged } from "../../sessions.js";
import { matchesInlineStopEmoji } from "../stopEmoji.js";
import { stopThread, type StopResult } from "../stopPipeline.js";

interface MentionConfigView {
  mentions: { enabled: boolean };
  reactions?: { stop?: string | null };
}

export interface MentionDeps {
  getConfig: () => MentionConfigView;
  processMessage: typeof processMessage;
  findSessionByThread: typeof findSessionByThread;
  setAttentionLevel: typeof setAttentionLevel;
  stopThread: (
    channelId: string,
    threadTs: string,
    triggeredByUserId: string,
    reason: string,
  ) => Promise<StopResult>;
}

export const defaultMentionDeps: MentionDeps = {
  getConfig,
  processMessage,
  findSessionByThread,
  setAttentionLevel,
  stopThread,
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

    if (matchesInlineStopEmoji(messageText, deps.getConfig().reactions?.stop)) {
      const threadTs = event.thread_ts || event.ts;
      logger.info(
        `Inline stop emoji in @mention from ${userLabel} in ${channelLabel} (thread ${threadTs})`,
      );
      await deps.stopThread(event.channel, threadTs, event.user, "stopped via inline emoji");
      return;
    }

    const rawFiles = "files" in event && Array.isArray(event.files) ? event.files : undefined;
    const attachments = extractAttachments(rawFiles);
    const hasImages = !!attachments.imageFiles?.length;

    if (!messageText && !event.thread_ts && !hasImages) {
      // No message content, no images, and not in a thread — nothing to work with
      await client.chat.postMessage({
        channel: event.channel,
        thread_ts: event.ts,
        text: t("errors.mention_no_question"),
      });
      return;
    }

    // Re-activate auto-respond tracking if the thread was disengaged
    if (event.thread_ts) {
      const existingSession = await deps.findSessionByThread(event.channel, event.thread_ts);
      if (existingSession && !isEngaged(existingSession)) {
        logger.info(
          `Re-activating auto-respond for session ${existingSession.sessionId}${await slackLink(client, event.channel, event.thread_ts)}`,
        );
        await deps.setAttentionLevel(existingSession.sessionId, "medium");
      }
    }

    const fallbackText = event.thread_ts
      ? "Read the conversation above and provide an answer or investigation based on what's being discussed."
      : "Answer based on the attached image(s).";

    await deps.processMessage({
      client,
      userId: event.user,
      channelId: event.channel,
      messageTs: event.ts,
      messageText: messageText || fallbackText,
      threadTs: event.thread_ts,
      triggerType: "mentions",
      // Slack mints action_token onto app_mention events; Bolt's types don't declare it.
      actionToken: (event as { action_token?: string }).action_token,
      ...attachments,
    });
  });
}
