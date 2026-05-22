import type { App } from "@slack/bolt";
import { logger } from "../logger.js";
import type { ThreadMessage } from "../sessions.js";
import type { ConversationMessage } from "../claude/index.js";
import { resolveUsers, transformUserMentions } from "./userCache.js";
import { openDmChannel } from "./channelResolver.js";
import {
  buildThreadMessage,
  extractMessageText,
  resolveReactionUsernames,
} from "./messageBuilder.js";
import { unfurlOptions } from "./unfurlOptions.js";

export interface SendMessageOptions {
  /** When true, disables Slack link/media unfurling on the posted message. */
  suppressUnfurls?: boolean;
}

export interface FetchThreadContextOptions {
  fetchUserNames?: boolean;
  limit?: number;
}

export async function fetchThreadContext(
  client: App["client"],
  channelId: string,
  threadTs: string,
  botUserId: string,
  options: FetchThreadContextOptions = {},
): Promise<ThreadMessage[]> {
  try {
    const result = await client.conversations.replies({
      channel: channelId,
      ts: threadTs,
      limit: options.limit ?? 20,
    });

    if (!result.messages) {
      return [];
    }

    const messages: ThreadMessage[] = result.messages
      .map((msg) => buildThreadMessage(msg, botUserId))
      .filter((msg): msg is ThreadMessage => msg !== null);

    // Resolve usernames and transform mentions if enabled
    if (options.fetchUserNames) {
      // Collect all user IDs: message authors + reaction users
      const allUserIds: string[] = [];
      for (const msg of messages) {
        allUserIds.push(msg.userId);
        if (msg.reactions) {
          for (const r of msg.reactions) {
            allUserIds.push(...r.userIds);
          }
        }
      }
      const userInfoMap = await resolveUsers(client, allUserIds);

      for (const msg of messages) {
        const userInfo = userInfoMap.get(msg.userId);
        if (userInfo) {
          msg.username = userInfo.username;
          msg.displayName = userInfo.displayName;
        }
        if (msg.reactions) {
          resolveReactionUsernames(msg.reactions, userInfoMap);
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
  threadTs?: string,
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
  threadTs: string,
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
  blocks?: object[],
  options: SendMessageOptions = {},
): Promise<void> {
  const channelId = await openDmChannel(client, userId);
  if (!channelId) return;
  try {
    await client.chat.postMessage({
      channel: channelId,
      text,
      ...(blocks && { blocks }),
      ...unfurlOptions(options.suppressUnfurls),
    });
  } catch (error) {
    logger.error("Failed to send direct message:", error);
  }
}

export interface ErrorReportOptions {
  sessionId: string;
  errorMessage: string;
  conversationTrace: ConversationMessage[];
  stderrOutput?: string;
  analysis: string;
}

export async function sendErrorReport(
  client: App["client"],
  userId: string,
  options: ErrorReportOptions,
  postOptions: SendMessageOptions = {},
): Promise<void> {
  const { sessionId, errorMessage, conversationTrace, stderrOutput, analysis } = options;

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
  ];

  const channelId = await openDmChannel(client, userId);
  if (!channelId) return;

  try {
    const msg = await client.chat.postMessage({
      channel: channelId,
      text: "Error Report - An error occurred while processing your request.",
      blocks,
      ...unfurlOptions(postOptions.suppressUnfurls),
    });

    // Upload full error report as a threaded reply to the error message
    const report = {
      sessionId,
      errorMessage,
      analysis,
      ...(stderrOutput && { stderrOutput }),
      conversationTrace,
    };
    const uploadArgs = {
      channel_id: channelId,
      filename: `error-report-${sessionId}.json`,
      content: JSON.stringify(report, null, 2),
      initial_comment: `Full error report (${conversationTrace.length} trace messages${stderrOutput ? ", includes stderr" : ""})`,
    };
    if (msg.ts) {
      await client.filesUploadV2({ ...uploadArgs, thread_ts: msg.ts });
    } else {
      await client.filesUploadV2(uploadArgs);
    }

    logger.debug(`Sent error report DM to user ${userId}`);
  } catch (error) {
    logger.error("Failed to send error report DM:", error);
    // Don't throw - error DM failure shouldn't block the response
  }
}
