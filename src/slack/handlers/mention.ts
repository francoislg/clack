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

    // A mention on a disengaged thread lifts the stop to "low" for the duration of the turn, so
    // a clarification typed while Clack is still answering is evaluated rather than dropped by
    // the isEngaged gate. Whether the lift outlives the turn is decided once the answer lands.
    const revivedSessionId = event.thread_ts
      ? await liftStopForTurn(client, event.channel, event.thread_ts, deps)
      : undefined;

    const fallbackText = event.thread_ts
      ? "Read the conversation above and provide an answer or investigation based on what's being discussed."
      : "Answer based on the attached image(s).";

    const response = await deps.processMessage({
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

    if (revivedSessionId) {
      await settleRevivedThread(revivedSessionId, response, deps);
    }
  });
}

/**
 * Raise a disengaged thread to `"low"` before its mention turn runs. Returns the session id when
 * a stop was actually lifted (so the caller must settle it afterwards), `undefined` otherwise.
 */
async function liftStopForTurn(
  client: App["client"],
  channel: string,
  threadTs: string,
  deps: MentionDeps,
): Promise<string | undefined> {
  const existingSession = await deps.findSessionByThread(channel, threadTs);
  if (!existingSession || isEngaged(existingSession)) return undefined;

  logger.info(
    `Lifting stop to "low" for the mention turn on session ${existingSession.sessionId}${await slackLink(client, channel, threadTs)}`,
  );
  await deps.setAttentionLevel(existingSession.sessionId, "low");
  return existingSession.sessionId;
}

/**
 * Decide whether a lifted stop outlives its turn, now that the answer's outcome is known.
 * A turn that produced no answer restores the stop; otherwise tracking stays at the `"low"`
 * floor. A level Claude chose itself is already persisted by the delivery layer and wins.
 */
async function settleRevivedThread(
  sessionId: string,
  response: Awaited<ReturnType<typeof processMessage>>,
  deps: MentionDeps,
): Promise<void> {
  if (response.attentionLevel) return;

  const answered = response.success && !response.skipped && !response.cancelled;
  if (answered) return;

  logger.info(
    `Mention turn produced no answer — restoring the stop on session ${sessionId} (success=${response.success}, skipped=${response.skipped ?? false}, cancelled=${response.cancelled ?? false})`,
  );
  await deps.setAttentionLevel(sessionId, "off");
}
