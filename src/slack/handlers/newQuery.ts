import type { App } from "@slack/bolt";
import { getConfig } from "../../config.js";
import { logger } from "../../logger.js";
import {
  createSession,
  findSessionByMessage,
  getSession,
  updateThreadContext,
  setLastAnswer,
} from "../../sessions.js";
import { askClaude } from "../../claude.js";
import { getResponseBlocks, getErrorBlocks } from "../blocks.js";
import { setSessionInfo } from "../state.js";
import { fetchThreadContext, fetchMessage, hasThreadReplies, sendDirectMessage } from "../messagesApi.js";
import { transformUserMentions } from "../userCache.js";

async function handleReaction(
  client: App["client"],
  userId: string,
  channelId: string,
  messageTs: string,
  threadTs?: string,
  preloadedMessageText?: string
): Promise<void> {
  const effectiveThreadTs = threadTs || messageTs;

  logger.debug(`Reaction detected from user ${userId} in channel ${channelId}`);

  // Use preloaded text if available, otherwise fetch
  const messageText = preloadedMessageText || await fetchMessage(client, channelId, messageTs, threadTs);
  if (!messageText) {
    logger.error("Could not fetch message text");
    await client.chat.postEphemeral({
      channel: channelId,
      user: userId,
      thread_ts: effectiveThreadTs,
      text: "Sorry, I couldn't read the message. Make sure I'm invited to this channel.",
      blocks: getErrorBlocks("Sorry, I couldn't read the message. Make sure I'm invited to this channel."),
    });
    return;
  }

  // Get bot user ID for thread context attribution
  const botUserId = (await client.auth.test()).user_id || "";

  const config = getConfig();

  // Fetch thread context
  const threadContext = await fetchThreadContext(client, channelId, effectiveThreadTs, botUserId, {
    fetchUserNames: config.slack.fetchAndStoreUsername,
  });

  // Transform user mentions in message text if enabled
  const processedMessageText = config.slack.fetchAndStoreUsername
    ? await transformUserMentions(client, messageText)
    : messageText;

  // Check for existing session or create new one
  let session = await findSessionByMessage(channelId, messageTs, userId);

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

  const thinkingFeedback = config.reactions.thinking;

  // Send thinking feedback (only on first query, not refine/update)
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
    await client.chat.postEphemeral({
      channel: channelId,
      user: userId,
      thread_ts: effectiveThreadTs,
      text: "Acknowledged, sending to Claude...",
    });
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
    logger.debug("Got response from Claude, posting ephemeral response...");

    await setLastAnswer(session.sessionId, response.answer);

    // Post ephemeral response with buttons (only visible to requester)
    await client.chat.postEphemeral({
      channel: channelId,
      user: userId,
      thread_ts: effectiveThreadTs,
      blocks: getResponseBlocks(response.answer, session.sessionId),
      text: response.answer,
    });

    // Send DM notification if thread is hidden (no replies yet)
    if (config.slack.notifyHiddenThread) {
      const threadHasReplies = await hasThreadReplies(client, channelId, effectiveThreadTs);
      if (!threadHasReplies) {
        try {
          const permalink = await client.chat.getPermalink({
            channel: channelId,
            message_ts: effectiveThreadTs,
          });
          if (permalink.permalink) {
            // Append thread_ts to open directly in thread view
            const threadLink = `${permalink.permalink}?thread_ts=${effectiveThreadTs}&cid=${channelId}`;
            await sendDirectMessage(
              client,
              userId,
              `Clack answered your question, but the thread isn't visible yet. Click here to see it: ${threadLink}`
            );
          }
        } catch (error) {
          logger.error("Failed to send hidden thread notification:", error);
        }
      }
    }
  } else {
    logger.error("Claude Code failed:", response.error);

    // Post ephemeral error message
    await client.chat.postEphemeral({
      channel: channelId,
      user: userId,
      thread_ts: effectiveThreadTs,
      text: `Sorry, I couldn't generate an answer: ${response.error || "Unknown error"}`,
      blocks: getErrorBlocks(`Sorry, I couldn't generate an answer: ${response.error || "Unknown error"}`),
    });
  }
}

export function registerNewQueryHandler(app: App): void {
  const config = getConfig();

  app.event("reaction_added", async ({ event, client }) => {
    logger.debug(`Reaction event: ${event.reaction} from ${event.user}`);

    if (event.reaction !== config.reactions.trigger) {
      logger.debug(`Ignoring reaction ${event.reaction}, waiting for ${config.reactions.trigger}`);
      return;
    }

    if (event.item.type !== "message") {
      logger.debug("Ignoring non-message reaction");
      return;
    }

    const { channel, ts } = event.item;
    const userId = event.user;

    // Detect thread context and fetch the actual message
    // Note: reaction_added doesn't include thread_ts, so we need to figure it out
    let threadTs: string | undefined;
    let actualMessageText: string | undefined;

    try {
      // Step 1: Try conversations.replies first - this works if ts is a parent message
      const repliesResult = await client.conversations.replies({
        channel,
        ts: ts,
        inclusive: true,
        limit: 1,
      });

      if (repliesResult.messages && repliesResult.messages.length > 0) {
        const msg = repliesResult.messages[0];
        if (msg.ts === ts) {
          // ts is a parent message - we found it directly
          threadTs = msg.thread_ts || ts;
          actualMessageText = msg.text;
          logger.debug(`Found message via conversations.replies (parent message)`);
        }
      }
    } catch (error) {
      // conversations.replies failed - ts might be a reply, not a parent
      // Or it's a channel-level message with no thread
      logger.debug("conversations.replies failed, trying history approach:", error);
    }

    if (!actualMessageText) {
      // Step 2: Fallback - try conversations.history for channel-level messages
      try {
        const histResult = await client.conversations.history({
          channel,
          latest: ts,
          inclusive: true,
          limit: 1,
        });

        if (histResult.messages && histResult.messages.length > 0) {
          const msg = histResult.messages[0];
          if (msg.ts === ts) {
            // Found the exact message in channel history
            threadTs = msg.thread_ts;
            actualMessageText = msg.text;
            logger.debug(`Found message via conversations.history (channel message)`);
          } else if (msg.thread_ts) {
            // Didn't find exact match - ts might be a thread reply
            // The returned message's thread_ts points to the parent thread
            // We need to search in that thread
            logger.debug(`Message not in channel history, searching in thread ${msg.thread_ts}`);
            threadTs = msg.thread_ts;

            // Fetch from the thread to find our actual message
            const threadResult = await client.conversations.replies({
              channel,
              ts: threadTs,
              limit: 100,
            });

            if (threadResult.messages) {
              const targetMsg = threadResult.messages.find((m) => m.ts === ts);
              if (targetMsg) {
                actualMessageText = targetMsg.text;
                logger.debug(`Found message in thread replies`);
              }
            }
          }
        }
      } catch (error) {
        logger.error("Error fetching message:", error);
      }
    }

    await handleReaction(client, userId, channel, ts, threadTs, actualMessageText);
  });
}
