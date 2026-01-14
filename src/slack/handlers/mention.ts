import type { App } from "@slack/bolt";
import {
  createSession,
  findSessionByMessage,
  getSession,
  updateThreadContext,
  setLastAnswer,
} from "../../sessions.js";
import { getConfig } from "../../config.js";
import { askClaude } from "../../claude.js";
import { getMessageBlocks, getInvestigatingBlocks, getErrorBlocks } from "../blocks.js";
import { setSessionInfo } from "../state.js";
import { fetchThreadContext } from "../messagesApi.js";

async function handleMention(
  client: App["client"],
  userId: string,
  channelId: string,
  messageTs: string,
  messageText: string,
  threadTs?: string
): Promise<void> {
  const effectiveThreadTs = threadTs || messageTs;

  console.log(`Mention from user ${userId} in channel ${channelId}`);

  // Get bot user ID for thread context attribution
  const botUserId = (await client.auth.test()).user_id || "";

  // Fetch thread context if in a thread
  const threadContext = threadTs
    ? await fetchThreadContext(client, channelId, threadTs, botUserId)
    : [];

  // Check for existing session or create new one
  let session = threadTs
    ? await findSessionByMessage(channelId, threadTs, userId)
    : null;

  if (!session) {
    session = await createSession(channelId, messageTs, effectiveThreadTs, userId, messageText, threadContext);
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

  const config = getConfig();
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
      console.error("Failed to add thinking reaction:", error);
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
    console.log("Got response from Claude, posting response...");

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
    console.error("Claude Code failed:", response.error);

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

export function registerMentionHandler(app: App): void {
  app.event("app_mention", async ({ event, client }) => {
    // Skip if no user (shouldn't happen for app_mention)
    if (!event.user) {
      return;
    }

    console.log(`App mention from ${event.user} in ${event.channel}`);

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
