import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import {
  buildThreadMessage,
  extractMessageText,
  resolveReactionUsernames,
  threadMessageToToolOutput,
  type SlackMessage,
  type ToolMessageEntry,
} from "../../slack/messageBuilder.js";
import type { SlackFile } from "../../slack/slackFileBase.js";
import { resolveUsers, transformUserMentions } from "../../slack/userCache.js";
import { getChannelInfo } from "../../slack/channelCache.js";
import { errorMessage } from "../../errors.js";

type SlackClient = NonNullable<QueryToolContext["slackClient"]>;
type UserInfoMap = Awaited<ReturnType<typeof resolveUsers>>;

interface ReplyEntry {
  user: string;
  text: string;
  ts: string | undefined;
  is_bot: boolean;
}

interface MessageEntry extends ToolMessageEntry {
  reply_count?: number;
  thread_replies?: ReplyEntry[];
  thread_error?: string;
}

export interface FetchChannelMessagesDeps {
  buildThreadMessage: typeof buildThreadMessage;
  resolveUsers: typeof resolveUsers;
  transformUserMentions: typeof transformUserMentions;
  getChannelInfo: typeof getChannelInfo;
}

export const defaultFetchChannelMessagesDeps: FetchChannelMessagesDeps = {
  buildThreadMessage,
  resolveUsers,
  transformUserMentions,
  getChannelInfo,
};

async function resolveReplyUserName(
  deps: FetchChannelMessagesDeps,
  client: SlackClient,
  replyUserId: string | undefined,
  userInfoMap: UserInfoMap,
): Promise<string> {
  if (!replyUserId) return "unknown";
  const cached = userInfoMap.get(replyUserId);
  if (cached) return cached.displayName ?? cached.username ?? replyUserId;
  const extraMap = await deps.resolveUsers(client, [replyUserId]);
  const extra = extraMap.get(replyUserId);
  return extra?.displayName ?? extra?.username ?? replyUserId;
}

async function fetchThreadReplies(
  deps: FetchChannelMessagesDeps,
  client: SlackClient,
  channelId: string,
  parentTs: string,
  userInfoMap: UserInfoMap,
): Promise<{ replies: ReplyEntry[] } | { error: string }> {
  try {
    const threadResult = await client.conversations.replies({
      channel: channelId,
      ts: parentTs,
      limit: 50,
    });

    if (!threadResult.messages || threadResult.messages.length <= 1) {
      return { replies: [] };
    }

    const replies: ReplyEntry[] = [];
    for (const reply of threadResult.messages.slice(1)) {
      const replyUserId = reply.user || reply.bot_id;
      replies.push({
        user: await resolveReplyUserName(deps, client, replyUserId, userInfoMap),
        text: await deps.transformUserMentions(client, extractMessageText(reply) || "[attachment]"),
        ts: reply.ts,
        is_bot: reply.bot_id !== undefined,
      });
    }
    return { replies };
  } catch {
    return { error: "Failed to fetch thread replies" };
  }
}

async function formatMessage(
  deps: FetchChannelMessagesDeps,
  client: SlackClient,
  msg: SlackMessage,
  channelId: string,
  userInfoMap: UserInfoMap,
  includeThreads: boolean,
  availableImages?: Map<string, import("../../slack/slackFileBase.js").SlackImageFile>,
  availableFiles?: Map<string, SlackFile>,
): Promise<MessageEntry | null> {
  // botUserId not available in tool context — bot detection relies on bot_id field
  const threadMsg = deps.buildThreadMessage(msg, "");
  if (!threadMsg) return null;

  // Resolve username for this message's author
  const userInfo = userInfoMap.get(threadMsg.userId);
  if (userInfo) {
    threadMsg.username = userInfo.username;
    threadMsg.displayName = userInfo.displayName;
  }

  if (threadMsg.reactions) {
    resolveReactionUsernames(threadMsg.reactions, userInfoMap);
  }

  // Transform <@USERID> mentions in message text
  threadMsg.text = await deps.transformUserMentions(client, threadMsg.text);

  // Register images and files in context maps
  if (threadMsg.imageFiles) {
    for (const img of threadMsg.imageFiles) availableImages?.set(img.id, img);
  }
  if (threadMsg.files) {
    for (const f of threadMsg.files) availableFiles?.set(f.id, f);
  }

  const entry: MessageEntry = { ...threadMessageToToolOutput(threadMsg) };

  if (msg.reply_count && msg.reply_count > 0) {
    entry.reply_count = msg.reply_count;

    if (includeThreads && msg.ts) {
      const result = await fetchThreadReplies(deps, client, channelId, msg.ts, userInfoMap);
      if ("error" in result) {
        entry.thread_error = result.error;
      } else if (result.replies.length > 0) {
        entry.thread_replies = result.replies;
      }
    }
  }

  return entry;
}

export function createFetchChannelMessagesTool(
  ctx: QueryToolContext,
  deps: FetchChannelMessagesDeps = defaultFetchChannelMessagesDeps,
) {
  return tool(
    "fetch_channel_messages",
    "Fetch recent messages from a Slack channel. Use this when you need to read what's being discussed in a channel — for example, when a user in an assistant thread asks about messages in the channel they're viewing.",
    {
      channel_id: z.string().describe("Slack channel ID (e.g. C0123456789)"),
      limit: z.number().optional().describe("Number of messages to fetch (default: 20, max: 100)"),
      oldest: z
        .string()
        .optional()
        .describe("Only messages after this Unix timestamp (e.g. '1234567890.123456')"),
      latest: z
        .string()
        .optional()
        .describe("Only messages before this Unix timestamp (e.g. '1234567890.123456')"),
      include_threads: z
        .boolean()
        .optional()
        .describe(
          "Whether to fetch thread replies for each message (default: false). Slower but gives full context.",
        ),
    },
    async (args) => {
      if (!ctx.slackClient) {
        return errorResult("Slack client is not available in this context");
      }
      const client = ctx.slackClient;
      const limit = Math.min(args.limit ?? 20, 100);

      try {
        const result = await client.conversations.history({
          channel: args.channel_id,
          limit,
          ...(args.oldest ? { oldest: args.oldest } : {}),
          ...(args.latest ? { latest: args.latest } : {}),
          inclusive: true,
        });

        const channelInfo = await deps.getChannelInfo(client, args.channel_id);

        if (!result.messages || result.messages.length === 0) {
          return textResult({
            channel: args.channel_id,
            ...(channelInfo && { channel_name: channelInfo.name }),
            messages: [],
            message_count: 0,
          });
        }

        const allUserIds: string[] = [];
        for (const msg of result.messages) {
          const authorId = msg.user || msg.bot_id;
          if (authorId) allUserIds.push(authorId);
          if (msg.reactions) {
            for (const r of msg.reactions) {
              if (r.users) allUserIds.push(...r.users);
            }
          }
        }
        const userInfoMap = await deps.resolveUsers(client, allUserIds);

        const messages = [];
        for (const msg of [...result.messages].reverse()) {
          const entry = await formatMessage(
            deps,
            client,
            msg,
            args.channel_id,
            userInfoMap,
            !!args.include_threads,
            ctx.availableImages,
            ctx.availableFiles,
          );
          if (entry) messages.push(entry);
        }

        return textResult({
          channel: args.channel_id,
          ...(channelInfo && { channel_name: channelInfo.name }),
          message_count: messages.length,
          has_more: result.has_more ?? false,
          messages,
        });
      } catch (error) {
        return errorResult(`Failed to fetch channel messages: ${errorMessage(error)}`);
      }
    },
  );
}
