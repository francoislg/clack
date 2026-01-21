import type { App } from "@slack/bolt";
import {
  createSession,
  findSessionByMessage,
  getSession,
  updateThreadContext,
  setLastAnswer,
  addError,
} from "../../sessions.js";
import { getConfig } from "../../config.js";
import { logger } from "../../logger.js";
import { askClaude, analyzeError } from "../../claude.js";
import { getMessageBlocks, getInvestigatingBlocks, getErrorBlocksWithRetry } from "../blocks.js";
import { setSessionInfo } from "../state.js";
import { fetchThreadContext, sendErrorReport } from "../messagesApi.js";
import { transformUserMentions } from "../userCache.js";

async function handleMention(
  client: App["client"],
  userId: string,
  channelId: string,
  messageTs: string,
  messageText: string,
  threadTs?: string
): Promise<void> {
  const effectiveThreadTs = threadTs || messageTs;

  logger.debug(`Mention from user ${userId} in channel ${channelId}`);

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

  const thinkingFeedback = config.mentions.thinking;

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

    const errorMessage = response.error || "Unknown error";
    const conversationTrace = response.conversationTrace || [];

    // Store the error in the session
    await addError(session.sessionId, errorMessage, conversationTrace);

    const errorText = `Claude seems to have crashed (session: ${session.sessionId}), maybe try again?`;

    if (thinkingMessageTs) {
      // Update the existing message with the error
      await client.chat.update({
        channel: channelId,
        ts: thinkingMessageTs,
        blocks: getErrorBlocksWithRetry(session.sessionId),
        text: errorText,
      });
    } else {
      // Post new message with the error
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: effectiveThreadTs,
        blocks: getErrorBlocksWithRetry(session.sessionId),
        text: errorText,
      });
    }

    // Send detailed error report via DM if enabled
    if (config.slack.sendErrorsAsDM) {
      try {
        const analysis = await analyzeError(errorMessage, conversationTrace);
        await sendErrorReport(client, userId, {
          sessionId: session.sessionId,
          errorMessage,
          conversationTrace,
          analysis,
        });
      } catch (dmError) {
        logger.error("Failed to send error report DM:", dmError);
      }
    }
  }
}

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

    await handleMention(
      client,
      event.user,
      event.channel,
      event.ts,
      messageText,
      event.thread_ts
    );
  });
}
