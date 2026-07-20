import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import { fetchThreadContext } from "../../slack/messagesApi.js";
import { threadMessageToToolOutput } from "../../slack/messageBuilder.js";
import { getChannelInfo } from "../../slack/channelCache.js";
import type { EmojiCache } from "../../slack/emojiCache.js";
import { buildLoreHint, collectEmojiNames } from "../../emojiLore.js";

export interface FetchSlackMessageDeps {
  fetchThreadContext: typeof fetchThreadContext;
  getChannelInfo: typeof getChannelInfo;
}

export const defaultFetchSlackMessageDeps: FetchSlackMessageDeps = {
  fetchThreadContext,
  getChannelInfo,
};

const SLACK_URL_PATTERN = /^https:\/\/[^/]+\.slack\.com\/archives\/([A-Z0-9]+)\/p(\d+)$/;
const MAX_FETCH = 200;

export function parseSlackMessageUrl(
  url: string,
): { channelId: string; messageTs: string; threadTs?: string } | null {
  let urlObj: URL;
  try {
    urlObj = new URL(url);
  } catch {
    return null;
  }

  const pathMatch = `${urlObj.origin}${urlObj.pathname}`.match(SLACK_URL_PATTERN);
  if (!pathMatch) return null;

  const channelId = pathMatch[1];
  const rawTs = pathMatch[2];
  // Convert p1234567890123456 → 1234567890.123456 (dot after 10th char)
  const messageTs = rawTs.slice(0, 10) + "." + rawTs.slice(10);

  const threadTs = urlObj.searchParams.get("thread_ts") ?? undefined;

  return { channelId, messageTs, threadTs };
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
      const parsed = parseSlackMessageUrl(args.url);
      if (!parsed) {
        return errorResult("Invalid Slack message URL format");
      }

      const { channelId, messageTs, threadTs } = parsed;
      if (!ctx.slackClient) {
        return errorResult("Slack client is not available in this context");
      }

      const page = args.page ?? 0;
      const limit = args.limit ?? 5;
      const fetchCount = (page + 1) * limit + 1; // +1 to detect has_more

      if ((page + 1) * limit > MAX_FETCH) {
        return errorResult(`Requested range exceeds maximum fetch cap of ${MAX_FETCH} messages`);
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

      // Register discovered images and files from the page
      for (const m of pageMessages) {
        if (m.imageFiles) {
          for (const img of m.imageFiles) ctx.availableImages?.set(img.id, img);
        }
        if (m.files) {
          for (const f of m.files) ctx.availableFiles?.set(f.id, f);
        }
      }

      const channelInfo = ctx.slackClient
        ? await deps.getChannelInfo(ctx.slackClient, channelId)
        : undefined;

      const output = pageMessages.map(threadMessageToToolOutput);
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
