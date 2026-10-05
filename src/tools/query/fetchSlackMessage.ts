import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import { fetchThreadContext } from "../../slack/messagesApi.js";
import { threadMessageToToolOutput } from "../../slack/messageBuilder.js";
import {
  parseSlackRef,
  readerGatesOf,
  resolveRefsInto,
  resolveSlackRefs,
} from "../../slack/slackRefs.js";
import { resolveRefForReader } from "../resolveRefForReader.js";
import { getChannelInfo } from "../../slack/channelCache.js";
import type { EmojiCache } from "../../slack/emojiCache.js";
import { buildLoreHint, collectEmojiNames } from "../../emojiLore.js";
import {
  ACCESS_DENIED_MESSAGE,
  accessRequestFrom,
  checkConversationAccess,
} from "../../slack/requesterAccess.js";

export interface FetchSlackMessageDeps {
  fetchThreadContext: typeof fetchThreadContext;
  getChannelInfo: typeof getChannelInfo;
  resolveSlackRefs: typeof resolveSlackRefs;
}

export const defaultFetchSlackMessageDeps: FetchSlackMessageDeps = {
  fetchThreadContext,
  getChannelInfo,
  resolveSlackRefs,
};

const MAX_FETCH = 200;

/** A Slack message permalink's channel, message ts and thread ts; null for anything else. */
export function parseSlackMessageUrl(
  url: string,
): { channelId: string; messageTs: string; threadTs?: string } | null {
  const parsed = parseSlackRef(url);
  if (parsed?.type !== "message") return null;
  return { channelId: parsed.channelId, messageTs: parsed.ts, threadTs: parsed.threadTs };
}

export function createFetchSlackMessageTool(
  ctx: QueryToolContext,
  deps: FetchSlackMessageDeps = defaultFetchSlackMessageDeps,
  emojiCache?: EmojiCache,
) {
  return tool(
    "fetch_slack_message",
    "Fetch a Slack message and its thread context from a URL, with pagination support. Returns the first 5 messages by default; use page/limit to load more.",
    {
      url: z
        .string()
        .describe(
          "Slack message URL (e.g. https://workspace.slack.com/archives/C123/p1234567890123456)",
        ),
      page: z.number().optional().describe("Page number, 0-indexed (default: 0)"),
      limit: z.number().optional().describe("Messages per page (default: 5)"),
    },
    async (args) => {
      const resolved = await resolveRefForReader(ctx, args.url, ["message"], {
        alwaysCheckAccess: false,
      });
      if (!resolved.ok) return resolved.error;
      if (resolved.ref.type !== "message") {
        return errorResult("Invalid Slack message URL format");
      }

      const { channelId, ts: messageTs, threadTs } = resolved.ref;
      if (!ctx.slackClient) {
        return errorResult("Slack client is not available in this context");
      }

      const page = args.page ?? 0;
      const limit = args.limit ?? 5;
      const fetchCount = (page + 1) * limit + 1; // +1 to detect has_more

      if ((page + 1) * limit > MAX_FETCH) {
        return errorResult(`Requested range exceeds maximum fetch cap of ${MAX_FETCH} messages`);
      }

      const req = accessRequestFrom({ ...ctx, slackClient: ctx.slackClient });
      const access = await checkConversationAccess(req, channelId);
      if (!access.allowed) {
        return errorResult(ACCESS_DENIED_MESSAGE);
      }

      // Use threadTs as parent if this is a reply URL, otherwise the message itself is the parent
      const parentTs = threadTs ?? messageTs;
      // botUserId not available in tool context — bot detection relies on bot_id field
      const messages = await deps.fetchThreadContext(ctx.slackClient, channelId, parentTs, "", {
        fetchUserNames: true,
        limit: fetchCount,
      });

      if (messages.length === 0) {
        return errorResult("Could not fetch thread or message not found");
      }

      // Slice to the requested page window
      const start = page * limit;
      const pageMessages = messages.slice(start, start + limit);
      const hasMore = messages.length > start + limit;

      // Resolve the page's references (attached files and refs in text) into the run's registry
      const pageRefs = await resolveRefsInto(
        req,
        readerGatesOf(ctx.config),
        pageMessages.map((m) => ({ text: m.text, files: m.files, fromCurrentMessage: false })),
        ctx.availableRefs ?? new Map(),
        deps,
      );

      const channelInfo = ctx.slackClient
        ? await deps.getChannelInfo(ctx.slackClient, channelId)
        : undefined;

      const output = pageMessages.map((m, i) => threadMessageToToolOutput(m, pageRefs[i]));
      const loreHint = emojiCache
        ? await buildLoreHint(collectEmojiNames(output), emojiCache)
        : null;

      return textResult({
        channel: channelId,
        ...(channelInfo && { channel_name: channelInfo.name }),
        thread_ts: parentTs,
        message_count: pageMessages.length,
        page,
        limit,
        has_more: hasMore,
        messages: output,
        ...(loreHint ? { lore_hint: loreHint } : {}),
      });
    },
  );
}
