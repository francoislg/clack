import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import { fetchMessage, fetchThreadContext } from "../../slack/messagesApi.js";

const SLACK_URL_PATTERN = /^https:\/\/[^/]+\.slack\.com\/archives\/([A-Z0-9]+)\/p(\d+)$/;

function parseSlackMessageUrl(url: string): { channelId: string; messageTs: string; threadTs?: string } | null {
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

export function createFetchSlackMessageTool(ctx: QueryToolContext) {
  return tool(
    "fetch_slack_message",
    "Fetch the content of a Slack message from its URL. Optionally include the full thread. Use this when a user shares a Slack message link and you need to read its content.",
    {
      url: z.string().describe("Slack message URL (e.g. https://workspace.slack.com/archives/C123/p1234567890123456)"),
      include_thread: z.boolean().optional().describe("Whether to fetch the full thread (default: false)"),
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
      const client = ctx.slackClient;

      if (args.include_thread) {
        // Fetch the full thread — use threadTs if it's a reply, otherwise the message itself is the parent
        const parentTs = threadTs ?? messageTs;
        const messages = await fetchThreadContext(client, channelId, parentTs, "", { fetchUserNames: true });

        if (messages.length === 0) {
          return errorResult("Could not fetch thread or message not found");
        }

        return textResult({
          channel: channelId,
          thread_ts: parentTs,
          message_count: messages.length,
          messages: messages.map((m) => ({
            user: m.displayName ?? m.username ?? m.userId,
            text: m.text,
            ts: m.ts,
            is_bot: m.isBot,
          })),
        });
      }

      // Fetch single message
      const text = await fetchMessage(client, channelId, messageTs, threadTs);

      if (!text) {
        return errorResult("Message not found or empty");
      }

      return textResult({ channel: channelId, ts: messageTs, text });
    }
  );
}
