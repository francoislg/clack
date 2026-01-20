import type { App } from "@slack/bolt";
import { logger } from "../logger.js";
import type { ThreadMessage } from "../sessions.js";
import { resolveUsers, transformUserMentions } from "./userCache.js";

export interface FetchThreadContextOptions {
  fetchUserNames?: boolean;
}

export async function fetchThreadContext(
  client: App["client"],
  channelId: string,
  threadTs: string,
  botUserId: string,
  options: FetchThreadContextOptions = {}
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

    const messages: ThreadMessage[] = result.messages
      .filter((msg) => msg.text && msg.user && msg.ts)
      .map((msg) => ({
        text: msg.text as string,
        userId: msg.user as string,
        isBot: msg.user === botUserId || msg.bot_id !== undefined,
        ts: msg.ts as string,
      }));

    // Resolve usernames and transform mentions if enabled
    if (options.fetchUserNames) {
      const userIds = messages.map((m) => m.userId);
      const userInfoMap = await resolveUsers(client, userIds);

      for (const msg of messages) {
        const userInfo = userInfoMap.get(msg.userId);
        if (userInfo) {
          msg.username = userInfo.username;
          msg.displayName = userInfo.displayName;
        }
        // Transform <@USERID> mentions in message text
        msg.text = await transformUserMentions(client, msg.text);
      }
    }

    return messages;
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
