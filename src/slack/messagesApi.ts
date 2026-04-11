import type { App } from "@slack/bolt";
import type { ConversationsRepliesResponse } from "@slack/web-api";
import type { KnownBlock, RichTextBlockElement, RichTextElement } from "@slack/types";
import { logger } from "../logger.js";
import type { ThreadMessage, SlackAttachment, SlackBlock } from "../sessions.js";
import type { ConversationMessage } from "../claude/index.js";
import { resolveUsers, transformUserMentions } from "./userCache.js";
import { extractAttachments } from "./fileExtractor.js";
import { openDmChannel } from "./channelResolver.js";

export type SlackMessage = NonNullable<ConversationsRepliesResponse["messages"]>[number];

// The auto-generated response types use `declare enum BlockType` which is
// nominally typed and rejects string literals. We use a union so that:
// - KnownBlock members suppress excess-property checking for typed block literals
// - The { type?: string } fallback accepts the auto-generated response types
type BlockLike = KnownBlock | { type?: string };

type MessageTextInput = Pick<SlackMessage, "text" | "attachments"> & {
  blocks?: BlockLike[];
};

const KNOWN_BLOCK_TYPES: ReadonlySet<string> = new Set<KnownBlock["type"]>([
  "actions",
  "context",
  "context_actions",
  "divider",
  "file",
  "header",
  "image",
  "input",
  "markdown",
  "rich_text",
  "section",
  "table",
  "task_card",
  "plan",
  "video",
]);

function isKnownBlock(block: BlockLike): block is KnownBlock {
  return typeof block.type === "string" && KNOWN_BLOCK_TYPES.has(block.type);
}

function extractRichTextLeaf(el: RichTextElement): string {
  switch (el.type) {
    case "text":
      return el.text;
    case "link":
      return el.text ?? el.url;
    case "emoji":
      return `:${el.name}:`;
    case "user":
      return `<@${el.user_id}>`;
    case "channel":
      return `<#${el.channel_id}>`;
    case "usergroup":
      return `<!subteam^${el.usergroup_id}>`;
    case "broadcast":
      return `@${el.range}`;
    case "color":
      return el.value;
    case "date":
      return el.fallback ?? "";
    default:
      return "";
  }
}

function extractRichTextBlockElement(el: RichTextBlockElement): string {
  switch (el.type) {
    case "rich_text_section":
      return el.elements.map(extractRichTextLeaf).join("");
    case "rich_text_list":
      return el.elements
        .map((item, i) => {
          const text = item.elements.map(extractRichTextLeaf).join("");
          return el.style === "ordered" ? `${i + 1}. ${text}` : `• ${text}`;
        })
        .join("\n");
    case "rich_text_quote":
      return el.elements
        .map(extractRichTextLeaf)
        .join("")
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    case "rich_text_preformatted":
      return "```\n" + el.elements.map((e) => ("text" in e ? e.text : "")).join("") + "\n```";
    default:
      return "";
  }
}

function extractBlockText(block: KnownBlock): string {
  switch (block.type) {
    case "section":
      return [block.text?.text, ...(block.fields?.map((f) => f.text) ?? [])]
        .filter(Boolean)
        .join("\n");
    case "header":
      return block.text.text;
    case "markdown":
      return block.text;
    case "rich_text":
      return block.elements.map(extractRichTextBlockElement).filter(Boolean).join("\n");
    case "context":
      return block.elements
        .filter(
          (e): e is Extract<(typeof block.elements)[number], { text: string }> =>
            "text" in e && typeof e.text === "string",
        )
        .map((e) => e.text)
        .join(" ");
    case "image":
      return block.alt_text;
    case "video":
      return block.title.text;
    default:
      return "";
  }
}

function extractBlocksText(blocks: BlockLike[]): string {
  return blocks.filter(isKnownBlock).map(extractBlockText).filter(Boolean).join("\n");
}

export function extractMessageText(msg: MessageTextInput): string {
  // Prefer blocks when present — they carry the full structured content.
  // msg.text is often a simplified notification fallback when blocks exist.
  if (msg.blocks?.length) {
    const blocksText = extractBlocksText(msg.blocks);
    if (blocksText) return blocksText;
  }
  return (
    msg.text ||
    msg.attachments
      ?.map((a) => a.text || a.fallback)
      .filter(Boolean)
      .join("\n") ||
    ""
  );
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
      .filter(
        (msg) =>
          (msg.text || msg.blocks?.length || msg.attachments?.length || msg.files?.length) &&
          (msg.user || msg.bot_id) &&
          msg.ts,
      )
      .map((msg) => {
        const blocks: SlackBlock[] | undefined = msg.blocks?.filter(
          (b): b is typeof b & SlackBlock => typeof b.type === "string",
        );
        const attachments: SlackAttachment[] | undefined = msg.attachments?.length
          ? msg.attachments.map((a) => ({
              ...(a.text && { text: a.text }),
              ...(a.fallback && { fallback: a.fallback }),
              ...(a.title && { title: a.title }),
              ...(a.pretext && { pretext: a.pretext }),
              ...(a.author_name && { author_name: a.author_name }),
              ...(a.fields?.length && {
                fields: a.fields.map((f) => ({
                  ...(f.title && { title: f.title }),
                  ...(f.value && { value: f.value }),
                })),
              }),
            }))
          : undefined;
        return {
          text: extractMessageText(msg) || "[attachment]",
          userId: (msg.user || msg.bot_id) as string,
          isBot: msg.user === botUserId || msg.bot_id !== undefined,
          ts: msg.ts as string,
          ...(blocks?.length && { blocks }),
          ...(attachments && { attachments }),
          ...extractAttachments(msg.files),
        };
      });

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
): Promise<void> {
  const channelId = await openDmChannel(client, userId);
  if (!channelId) return;
  try {
    await client.chat.postMessage({
      channel: channelId,
      text,
      ...(blocks && { blocks }),
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
