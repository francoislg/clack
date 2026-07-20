import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import type { EmojiCache } from "../../slack/emojiCache.js";
import { buildLoreHint, collectEmojiNames } from "../../emojiLore.js";
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
import { slackLink } from "../../slack/logContext.js";
import { errorMessage } from "../../errors.js";

type SlackClient = NonNullable<QueryToolContext["slackClient"]>;
type UserInfoMap = Awaited<ReturnType<typeof resolveUsers>>;

interface LastReply {
  user: string;
  text: string;
  ts: string | undefined;
  at_iso?: string; // human-readable form of `ts` (UTC), so the model can reason about time
  is_bot: boolean;
}

interface MessageEntry extends ToolMessageEntry {
  at_iso?: string; // human-readable form of `ts` (UTC)
  reply_count?: number; // total replies in the thread
  last_reply?: LastReply; // only the single most-recent reply (read the full thread via fetch_slack_message)
  url?: string; // permalink to pass to fetch_slack_message to read the whole thread
  thread_error?: string;
}

// A full fetch of a busy channel (Block Kit JSON per message × every thread reply in full)
// can balloon past the model's tool-result limit, after which the SDK spills it to a file
// the model also can't read — so the caller effectively sees nothing. We keep the result
// small: raw blocks are dropped, long text is truncated, and threads are summarized to their
// reply count + single newest reply. To read a whole thread, the model uses `fetch_slack_message`.
const MAX_TEXT_CHARS = 600;

function truncateText(text: string): string {
  if (text.length <= MAX_TEXT_CHARS) return text;
  return `${text.slice(0, MAX_TEXT_CHARS)}… [truncated from ${text.length} chars — read the full message via fetch_slack_message using this message's url]`;
}

// Slack `ts` values are epoch "seconds.micros" strings; surface a human-readable UTC form
// alongside so the model can compare against `fetched_at` for recency without guessing "now".
function epochToIso(ts: string | undefined): string | undefined {
  if (!ts) return undefined;
  const seconds = parseFloat(ts);
  if (Number.isNaN(seconds)) return undefined;
  return new Date(seconds * 1000).toISOString();
}

export interface FetchChannelMessagesDeps {
  buildThreadMessage: typeof buildThreadMessage;
  resolveUsers: typeof resolveUsers;
  transformUserMentions: typeof transformUserMentions;
  getChannelInfo: typeof getChannelInfo;
  slackLink: typeof slackLink;
}

function normalizeSlackTimestamp(input: string): string | { error: string } {
  if (/^\d+(\.\d+)?$/.test(input)) {
    return input;
  }
  const parsed = Date.parse(input);
  if (Number.isNaN(parsed)) {
    return {
      error: `"${input}" is neither a Unix epoch timestamp nor a parseable ISO 8601 datetime`,
    };
  }
  return (parsed / 1000).toFixed(6);
}

export const defaultFetchChannelMessagesDeps: FetchChannelMessagesDeps = {
  buildThreadMessage,
  resolveUsers,
  transformUserMentions,
  getChannelInfo,
  slackLink,
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

async function fetchLastReply(
  deps: FetchChannelMessagesDeps,
  client: SlackClient,
  channelId: string,
  parentTs: string,
  latestReplyTs: string,
  userInfoMap: UserInfoMap,
): Promise<{ last: LastReply } | { error: string }> {
  try {
    // Pin to the newest reply's ts (from the history payload) and ask for just that one
    // message — one tiny call, no full-thread download. The full thread is read on demand
    // by the caller via fetch_slack_message.
    const threadResult = await client.conversations.replies({
      channel: channelId,
      ts: parentTs,
      latest: latestReplyTs,
      inclusive: true,
      limit: 1,
    });

    const reply = threadResult.messages?.find((m) => m.ts !== parentTs);
    if (!reply) {
      return { error: "Failed to fetch latest reply" };
    }

    const replyUserId = reply.user || reply.bot_id;
    return {
      last: {
        user: await resolveReplyUserName(deps, client, replyUserId, userInfoMap),
        text: truncateText(
          await deps.transformUserMentions(client, extractMessageText(reply) || "[attachment]"),
        ),
        ts: reply.ts,
        at_iso: epochToIso(reply.ts),
        is_bot: reply.bot_id !== undefined,
      },
    };
  } catch {
    return { error: "Failed to fetch latest reply" };
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
  threadMsg.text = truncateText(await deps.transformUserMentions(client, threadMsg.text));

  // Register images and files in context maps
  if (threadMsg.imageFiles) {
    for (const img of threadMsg.imageFiles) availableImages?.set(img.id, img);
  }
  if (threadMsg.files) {
    for (const f of threadMsg.files) availableFiles?.set(f.id, f);
  }

  // Raw Block Kit / attachment JSON is the single biggest contributor to output bloat
  // (a trivia post alone can be many KB) and is redundant with `text` for reading a channel.
  // Clear them at the source so the tool output never carries them.
  threadMsg.blocks = undefined;
  threadMsg.attachments = undefined;

  const entry: MessageEntry = { ...threadMessageToToolOutput(threadMsg) };
  entry.at_iso = epochToIso(entry.ts);

  // Permalink on every message: the dig handle for fetch_slack_message, whether the model
  // wants a full thread or the full text of a message whose `text` was truncated above.
  if (msg.ts) {
    entry.url = (await deps.slackLink(client, channelId, msg.ts)).trim();
  }

  if (msg.reply_count && msg.reply_count > 0 && msg.ts) {
    entry.reply_count = msg.reply_count;

    // Surface only the single newest reply (the freshness/human-leaf signal). The full
    // thread is read on demand, not dumped here.
    if (includeThreads && msg.latest_reply) {
      const result = await fetchLastReply(
        deps,
        client,
        channelId,
        msg.ts,
        msg.latest_reply,
        userInfoMap,
      );
      if ("error" in result) {
        entry.thread_error = result.error;
      } else {
        entry.last_reply = result.last;
      }
    }
  }

  return entry;
}

export function createFetchChannelMessagesTool(
  ctx: QueryToolContext,
  deps: FetchChannelMessagesDeps = defaultFetchChannelMessagesDeps,
  emojiCache?: EmojiCache,
) {
  return tool(
    "fetch_channel_messages",
    "Fetch recent top-level messages from a Slack channel. Use this to read what's being discussed — e.g. when a user in an assistant thread asks about the channel they're viewing. This returns an OVERVIEW, not full content: every message carries a `url` (permalink) plus `ts` (Slack epoch) and `at_iso` (human-readable UTC time); threaded messages also carry `reply_count` (total replies) and `last_reply` (only the single newest reply — itself with `ts`/`at_iso`/`is_bot` — the freshness signal); long message text is truncated. The top-level `fetched_at` gives the current time so you can judge recency. To read a full thread OR the full text of a truncated message, pass that message's `url` to `fetch_slack_message`.",
    {
      channel_id: z.string().describe("Slack channel ID (e.g. C0123456789)"),
      limit: z.number().optional().describe("Number of messages to fetch (default: 20, max: 100)"),
      oldest: z
        .string()
        .optional()
        .describe(
          "Only messages after this timestamp. Accepts a Unix epoch string (e.g. '1234567890.123456' or '1234567890') or an ISO 8601 datetime (e.g. '2026-04-22T00:00:00-04:00' or '2026-04-22').",
        ),
      latest: z
        .string()
        .optional()
        .describe(
          "Only messages before this timestamp. Accepts a Unix epoch string (e.g. '1234567890.123456' or '1234567890') or an ISO 8601 datetime (e.g. '2026-04-22T23:59:59-04:00' or '2026-04-22').",
        ),
      include_threads: z
        .boolean()
        .optional()
        .describe(
          "Whether to include each thread's single newest reply as `last_reply` (default: false). `reply_count` and `url` are always present on threaded messages regardless; read a full thread with fetch_slack_message.",
        ),
    },
    async (args) => {
      if (!ctx.slackClient) {
        return errorResult("Slack client is not available in this context");
      }
      const client = ctx.slackClient;
      const limit = Math.min(args.limit ?? 20, 100);

      let normalizedOldest: string | undefined;
      if (args.oldest !== undefined) {
        const outcome = normalizeSlackTimestamp(args.oldest);
        if (typeof outcome !== "string") {
          return errorResult(`Invalid 'oldest' argument: ${outcome.error}`);
        }
        normalizedOldest = outcome;
      }

      let normalizedLatest: string | undefined;
      if (args.latest !== undefined) {
        const outcome = normalizeSlackTimestamp(args.latest);
        if (typeof outcome !== "string") {
          return errorResult(`Invalid 'latest' argument: ${outcome.error}`);
        }
        normalizedLatest = outcome;
      }

      const windowEcho: Record<string, string> = {};
      if (normalizedOldest !== undefined) {
        windowEcho.oldest = normalizedOldest;
        windowEcho.oldest_iso = new Date(parseFloat(normalizedOldest) * 1000).toISOString();
      }
      if (normalizedLatest !== undefined) {
        windowEcho.latest = normalizedLatest;
        windowEcho.latest_iso = new Date(parseFloat(normalizedLatest) * 1000).toISOString();
      }

      try {
        const result = await client.conversations.history({
          channel: args.channel_id,
          limit,
          ...(normalizedOldest !== undefined ? { oldest: normalizedOldest } : {}),
          ...(normalizedLatest !== undefined ? { latest: normalizedLatest } : {}),
          inclusive: true,
        });

        const channelInfo = await deps.getChannelInfo(client, args.channel_id);

        if (!result.messages || result.messages.length === 0) {
          return textResult({
            channel: args.channel_id,
            ...(channelInfo && { channel_name: channelInfo.name }),
            ...(channelInfo?.purpose && { channel_purpose: channelInfo.purpose }),
            message_count: 0,
            has_more: result.has_more ?? false,
            ...windowEcho,
            messages: [],
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

        // Reference clock so the model can judge recency ("within the last 2 hours")
        // against an explicit now rather than guessing from the freshest message.
        const now = new Date();
        const loreHint = emojiCache
          ? await buildLoreHint(collectEmojiNames(messages), emojiCache)
          : null;
        return textResult({
          channel: args.channel_id,
          ...(channelInfo && { channel_name: channelInfo.name }),
          ...(channelInfo?.purpose && { channel_purpose: channelInfo.purpose }),
          fetched_at: { epoch: (now.getTime() / 1000).toFixed(6), iso: now.toISOString() },
          message_count: messages.length,
          has_more: result.has_more ?? false,
          ...windowEcho,
          messages,
          ...(loreHint ? { lore_hint: loreHint } : {}),
        });
      } catch (error) {
        return errorResult(`Failed to fetch channel messages: ${errorMessage(error)}`);
      }
    },
  );
}
