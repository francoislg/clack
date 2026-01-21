import type { App } from "@slack/bolt";
import {
  createSession,
  findSessionByMessage,
  getSession,
  updateThreadContext,
  setLastAnswer,
} from "../../sessions.js";
import { getConfig } from "../../config.js";
import { logger } from "../../logger.js";
import { askClaude } from "../../claude.js";
import { getMessageBlocks, getInvestigatingBlocks, getErrorBlocks } from "../blocks.js";
import { setSessionInfo } from "../state.js";
import { fetchThreadContext } from "../messagesApi.js";
import { transformUserMentions } from "../userCache.js";

async function handleDirectMessage(
  client: App["client"],
  userId: string,
  channelId: string,
  messageTs: string,
  messageText: string,
  threadTs?: string
): Promise<void> {
  const effectiveThreadTs = threadTs || messageTs;

  logger.debug(`Direct message from user ${userId} in channel ${channelId}`);

  // Get bot user ID for thread context attribution
  const botUserId = (await client.auth.test()).user_id || "";

  const config = getConfig();

  // Fetch thread context if in a thread
  const threadContext = threadTs
    ? await fetchThreadContext(client, channelId, threadTs, botUserId, {
        fetchUserNames: config.slack.fetchAndStoreUsername,
      })
    : [];

  // Transform user mentions in message text if enabled
  const processedMessageText = config.slack.fetchAndStoreUsername
    ? await transformUserMentions(client, messageText)
    : messageText;

  // Check for existing session or create new one
  let session = threadTs
    ? await findSessionByMessage(channelId, threadTs, userId)
    : null;

  if (!session) {
    session = await createSession(channelId, messageTs, effectiveThreadTs, userId, processedMessageText, threadContext);
  } else {
    await updateThreadContext(session.sessionId, threadContext);
    session = (await getSession(session.sessionId))!;
  }

  // Store session info for later responses
  setSessionInfo(session.sessionId, {
    channelId,
    threadTs: effectiveThreadTs,
    userId,
  });

  const thinkingFeedback = config.directMessages.thinking;

  // Send thinking feedback
  let thinkingMessageTs: string | undefined;
  if (thinkingFeedback?.type === "emoji" && thinkingFeedback.emoji) {
    try {
      await client.reactions.add({
        channel: channelId,
        timestamp: messageTs,
        name: thinkingFeedback.emoji,
      });
    } catch (error) {
      logger.error("Failed to add thinking reaction:", error);
    }
  } else {
    // Post visible "Investigating..." message in a thread
    const thinkingMessage = await client.chat.postMessage({
      channel: channelId,
      thread_ts: effectiveThreadTs,
      blocks: getInvestigatingBlocks(),
      text: "Investigating...",
    });
    thinkingMessageTs = thinkingMessage.ts;
  }

  // Ask Claude
  logger.info(`Calling Claude Code (session: ${session.sessionId})...`);
  const response = await askClaude(session);

  // Remove thinking emoji if used
  if (thinkingFeedback?.type === "emoji" && thinkingFeedback.emoji) {
    try {
      await client.reactions.remove({
        channel: channelId,
        timestamp: messageTs,
        name: thinkingFeedback.emoji,
      });
    } catch (error) {
      logger.error("Failed to remove thinking reaction:", error);
    }
  }

  if (response.success) {
    logger.debug("Got response from Claude, posting response...");

    await setLastAnswer(session.sessionId, response.answer);

    if (thinkingMessageTs) {
      // Update the existing message with the response
      await client.chat.update({
        channel: channelId,
        ts: thinkingMessageTs,
        blocks: getMessageBlocks(response.answer),
        text: response.answer,
      });
    } else {
      // Post new message with the response
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: effectiveThreadTs,
        blocks: getMessageBlocks(response.answer),
        text: response.answer,
      });
    }
  } else {
    logger.error("Claude Code failed:", response.error);

    const errorText = `Sorry, I couldn't generate an answer: ${response.error || "Unknown error"}`;

    if (thinkingMessageTs) {
      // Update the existing message with the error
      await client.chat.update({
        channel: channelId,
        ts: thinkingMessageTs,
        blocks: getErrorBlocks(errorText),
        text: errorText,
      });
    } else {
      // Post new message with the error
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: effectiveThreadTs,
        blocks: getErrorBlocks(errorText),
        text: errorText,
      });
    }
  }
}

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
    if (!msg.user) {
      return;
    }

    logger.debug(`DM from ${msg.user} in ${msg.channel}`);

    await handleDirectMessage(
      client,
      msg.user,
      msg.channel,
      msg.ts,
      msg.text || "",
      msg.thread_ts
    );
  });
}
