import type { App } from "@slack/bolt";
import { logger } from "../logger.js";
import type { ThreadMessage } from "../sessions.js";
import type { ConversationMessage } from "../claude.js";
import { resolveUsers, transformUserMentions } from "./userCache.js";

export function extractMessageText(msg: { text?: string; attachments?: { text?: string; fallback?: string }[] }): string {
  return msg.text || msg.attachments?.map(a => a.text || a.fallback).filter(Boolean).join("\n") || "";
}

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
      .filter((msg) => (msg.text || msg.attachments?.length) && (msg.user || msg.bot_id) && msg.ts)
      .map((msg) => ({
        text: extractMessageText(msg) || "[attachment]",
        userId: (msg.user || msg.bot_id) as string,
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
          return extractMessageText(message);
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
      return extractMessageText(result.messages[0]);
    }
    return "";
  } catch (error) {
    logger.error("Failed to fetch message:", error);
    return "";
  }
}

export async function hasThreadReplies(
  client: App["client"],
  channelId: string,
  threadTs: string
): Promise<boolean> {
  try {
    const result = await client.conversations.replies({
      channel: channelId,
      ts: threadTs,
      limit: 2,
    });
    // First message is the parent, any additional messages are replies
    return (result.messages?.length ?? 1) > 1;
  } catch (error) {
    logger.error("Failed to check thread replies:", error);
    return false;
  }
}

export async function sendDirectMessage(
  client: App["client"],
  userId: string,
  text: string,
  blocks?: object[]
): Promise<void> {
  try {
    const conversation = await client.conversations.open({ users: userId });
    if (conversation.channel?.id) {
      await client.chat.postMessage({
        channel: conversation.channel.id,
        text,
        ...(blocks && { blocks }),
      });
    }
  } catch (error) {
    logger.error("Failed to send direct message:", error);
  }
}

export interface ErrorReportOptions {
  sessionId: string;
  errorMessage: string;
  conversationTrace: ConversationMessage[];
  analysis: string;
}

export async function sendErrorReport(
  client: App["client"],
  userId: string,
  options: ErrorReportOptions
): Promise<void> {
  const { sessionId, errorMessage, conversationTrace, analysis } = options;

  // Format the last 5-10 messages from the trace
  const recentTrace = conversationTrace.slice(-10);
  const traceSummary = recentTrace
    .map((m) => {
      const typeLabel = m.subtype ? `${m.type}:${m.subtype}` : m.type;
      const content = m.content.length > 200 ? m.content.substring(0, 200) + "..." : m.content;
      return `• [${typeLabel}] ${content}`;
    })
    .join("\n");

  const blocks = [
    {
      type: "header" as const,
      text: {
        type: "plain_text" as const,
        text: "⚠️ Error Report",
        emoji: true,
      },
    },
    {
      type: "section" as const,
      text: {
        type: "mrkdwn" as const,
        text: `An error occurred while processing your request.`,
      },
    },
    {
      type: "section" as const,
      fields: [
        {
          type: "mrkdwn" as const,
          text: `*Session ID:*\n\`${sessionId}\``,
        },
        {
          type: "mrkdwn" as const,
          text: `*Error:*\n${errorMessage}`,
        },
      ],
    },
    {
      type: "divider" as const,
    },
    {
      type: "section" as const,
      text: {
        type: "mrkdwn" as const,
        text: `*Analysis:*\n${analysis}`,
      },
    },
    {
      type: "divider" as const,
    },
    {
      type: "section" as const,
      text: {
        type: "mrkdwn" as const,
        text: `*Conversation Trace (last ${recentTrace.length} messages):*\n\`\`\`${traceSummary}\`\`\``,
      },
    },
  ];

  try {
    const conversation = await client.conversations.open({ users: userId });
    if (conversation.channel?.id) {
      await client.chat.postMessage({
        channel: conversation.channel.id,
        text: "Error Report - An error occurred while processing your request.",
        blocks,
      });
      logger.debug(`Sent error report DM to user ${userId}`);
    }
  } catch (error) {
    logger.error("Failed to send error report DM:", error);
    // Don't throw - error DM failure shouldn't block the response
  }
}
