import type { App } from "@slack/bolt";
import { logger } from "../logger.js";
import type { ThreadMessage } from "../sessions.js";

export async function fetchThreadContext(
  client: App["client"],
  channelId: string,
  threadTs: string,
  botUserId: string
): Promise<ThreadMessage[]> {
  try {
    const result = await client.conversations.replies({
      channel: channelId,
      ts: threadTs,
      limit: 20,
    });

    if (!result.messages) {
      return [];
    }

    return result.messages
      .filter((msg) => msg.text && msg.user && msg.ts)
      .map((msg) => ({
        text: msg.text as string,
        userId: msg.user as string,
        isBot: msg.user === botUserId || msg.bot_id !== undefined,
        ts: msg.ts as string,
      }));
  } catch (error) {
    logger.error("Failed to fetch thread context:", error);
    return [];
  }
}

export async function fetchMessage(
  client: App["client"],
  channelId: string,
  messageTs: string,
  threadTs?: string
): Promise<string> {
  try {
    // If message is in a thread, use conversations.replies to fetch it
    if (threadTs && threadTs !== messageTs) {
      const result = await client.conversations.replies({
        channel: channelId,
        ts: threadTs,
        limit: 100,
      });

      if (result.messages) {
        const message = result.messages.find((msg) => msg.ts === messageTs);
        if (message) {
          return message.text || "";
        }
      }
      return "";
    }

    // For top-level messages, use conversations.history
    const result = await client.conversations.history({
      channel: channelId,
      latest: messageTs,
      inclusive: true,
      limit: 1,
    });

    if (result.messages && result.messages.length > 0) {
      return result.messages[0].text || "";
    }
    return "";
  } catch (error) {
    logger.error("Failed to fetch message:", error);
    return "";
  }
}
