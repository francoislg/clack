import type { App } from "@slack/bolt";
import { getConfig } from "../../config.js";
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
import { fetchThreadContext, fetchMessage } from "../messagesApi.js";

async function handleReaction(
  client: App["client"],
  userId: string,
  channelId: string,
  messageTs: string,
  threadTs?: string
): Promise<void> {
  const effectiveThreadTs = threadTs || messageTs;

  console.log(`Reaction detected from user ${userId} in channel ${channelId}`);

  // Fetch the original message
  const messageText = await fetchMessage(client, channelId, messageTs);
  if (!messageText) {
    console.error("Could not fetch message text");
    await client.chat.postEphemeral({
      channel: channelId,
      user: userId,
      thread_ts: effectiveThreadTs,
      text: "Sorry, I couldn't read the message. Make sure I'm invited to this channel.",
      blocks: getErrorBlocks("Sorry, I couldn't read the message. Make sure I'm invited to this channel."),
    });
    return;
  }

  // Fetch thread context
  const threadContext = await fetchThreadContext(client, channelId, effectiveThreadTs);

  // Check for existing session or create new one
  let session = findSessionByMessage(channelId, messageTs, userId);

  if (!session) {
    session = createSession(channelId, messageTs, effectiveThreadTs, userId, messageText, threadContext);
  } else {
    updateThreadContext(session.sessionId, threadContext);
    session = getSession(session.sessionId)!;
  }

  // Store session info for later responses
  setSessionInfo(session.sessionId, {
    channelId,
    threadTs: effectiveThreadTs,
    userId,
  });

  const config = getConfig();
  const thinkingFeedback = config.thinkingFeedback;

  // Send thinking feedback (only on first query, not refine/update)
  if (thinkingFeedback?.type === "emoji" && thinkingFeedback.emoji) {
    try {
      await client.reactions.add({
        channel: channelId,
        timestamp: messageTs,
        name: thinkingFeedback.emoji,
      });
    } catch (error) {
      console.error("Failed to add thinking reaction:", error);
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
  console.log("Calling Claude Code...");
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
      console.error("Failed to remove thinking reaction:", error);
    }
  }

  if (response.success) {
    console.log("Got response from Claude, posting ephemeral response...");

    setLastAnswer(session.sessionId, response.answer);

    // Post ephemeral response with buttons (only visible to requester)
    await client.chat.postEphemeral({
      channel: channelId,
      user: userId,
      thread_ts: effectiveThreadTs,
      blocks: getResponseBlocks(response.answer, session.sessionId),
      text: response.answer,
    });
  } else {
    console.error("Claude Code failed:", response.error);

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
    console.log(`Reaction event: ${event.reaction} from ${event.user}`);

    if (event.reaction !== config.triggerReaction) {
      console.log(`Ignoring reaction ${event.reaction}, waiting for ${config.triggerReaction}`);
      return;
    }

    if (event.item.type !== "message") {
      console.log("Ignoring non-message reaction");
      return;
    }

    const { channel, ts } = event.item;
    const userId = event.user;

    // Get thread_ts if it exists
    let threadTs: string | undefined;
    try {
      const msgResult = await client.conversations.history({
        channel,
        latest: ts,
        inclusive: true,
        limit: 1,
      });
      if (msgResult.messages && msgResult.messages.length > 0) {
        threadTs = msgResult.messages[0].thread_ts;
      }
    } catch (error) {
      console.error("Error fetching thread context:", error);
    }

    await handleReaction(client, userId, channel, ts, threadTs);
  });
}
