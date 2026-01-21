import type { App } from "@slack/bolt";
import {
  findSessionByThread,
  createSession,
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

    logger.debug(`Thread reply in ${msg.channel} thread ${msg.thread_ts} from ${msg.user}`);

    // Find existing session or create from thread context
    let session = await findSessionByThread(msg.channel, msg.thread_ts);

    // Get bot user ID for thread context attribution
    const botUserId = (await client.auth.test()).user_id || "";

    const config = getConfig();

    // Fetch thread context with proper attribution
    const threadContext = await fetchThreadContext(client, msg.channel, msg.thread_ts, botUserId, {
      fetchUserNames: config.slack.fetchAndStoreUsername,
    });

    // We still need thread messages for root message info
    const threadMessages = await client.conversations.replies({
      channel: msg.channel,
      ts: msg.thread_ts,
      limit: 1, // Just need the root message
    });

    if (!session) {
      // Create session from thread context
      const threadRoot = threadMessages.messages?.[0];
      const rootText = threadRoot?.text || "";

      // Transform user mentions in root message text if enabled
      const processedRootText = config.slack.fetchAndStoreUsername
        ? await transformUserMentions(client, rootText)
        : rootText;

      session = await createSession(
        msg.channel,
        msg.thread_ts,
        msg.thread_ts,
        threadRoot?.user || msg.user,
        processedRootText,
        threadContext
      );
      logger.debug(`Created session ${session.sessionId} from thread context`);
    } else {
      // Update existing session with latest context
      await updateThreadContext(session.sessionId, threadContext);
      session = (await getSession(session.sessionId))!;
    }

    // Update session info
    setSessionInfo(session.sessionId, {
      channelId: msg.channel,
      threadTs: msg.thread_ts,
      userId: msg.user,
    });

    const thinkingFeedback = config.directMessages.thinking;

    // Send thinking feedback
    let thinkingMessageTs: string | undefined;
    if (thinkingFeedback?.type === "emoji" && thinkingFeedback.emoji) {
      try {
        // Add emoji to the reply message itself, not the thread
        await client.reactions.add({
          channel: msg.channel,
          timestamp: msg.ts,
          name: thinkingFeedback.emoji,
        });
      } catch (error) {
        logger.error("Failed to add thinking reaction:", error);
      }
    } else {
      // Post visible "Investigating..." message in the thread
      const thinkingMessage = await client.chat.postMessage({
        channel: msg.channel,
        thread_ts: msg.thread_ts,
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
          channel: msg.channel,
          timestamp: msg.ts,
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
          channel: msg.channel,
          ts: thinkingMessageTs,
          blocks: getMessageBlocks(response.answer),
          text: response.answer,
        });
      } else {
        // Post new message with the response
        await client.chat.postMessage({
          channel: msg.channel,
          thread_ts: msg.thread_ts,
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
          channel: msg.channel,
          ts: thinkingMessageTs,
          blocks: getErrorBlocks(errorText),
          text: errorText,
        });
      } else {
        // Post new message with the error
        await client.chat.postMessage({
          channel: msg.channel,
          thread_ts: msg.thread_ts,
          blocks: getErrorBlocks(errorText),
          text: errorText,
        });
      }
    }
  });
}
