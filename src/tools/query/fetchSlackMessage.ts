import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import { extractMessageText, fetchThreadContext } from "../../slack/messagesApi.js";
import { extractImageFiles } from "../../slack/imageExtractor.js";
import { extractFiles } from "../../slack/fileExtractor.js";

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

        // Register discovered images and files so viewing tools can access them
        for (const m of messages) {
          if (m.imageFiles) {
            for (const img of m.imageFiles) ctx.availableImages?.set(img.id, img);
          }
          if (m.files) {
            for (const f of m.files) ctx.availableFiles?.set(f.id, f);
          }
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
            ...(m.imageFiles?.length && { images: m.imageFiles.map((f) => ({ file_id: f.id, name: f.name })) }),
            ...(m.files?.length && { files: m.files.map((f) => ({ file_id: f.id, name: f.name, type: f.mimetype })) }),
          })),
        });
      }

      // Fetch single message — need full message object for files
      const result = threadTs
        ? await client.conversations.replies({ channel: channelId, ts: threadTs, limit: 100 })
        : await client.conversations.history({ channel: channelId, latest: messageTs, inclusive: true, limit: 1 });

      const msg = threadTs
        ? result.messages?.find((m) => m.ts === messageTs)
        : result.messages?.[0]?.ts === messageTs ? result.messages[0] : undefined;

      const text = msg ? extractMessageText(msg) : "";
      if (!text && !msg?.files?.length) {
        return errorResult("Message not found or empty");
      }

      // Extract and register images and files
      const imageFiles = extractImageFiles(msg?.files as unknown[] | undefined);
      for (const img of imageFiles) ctx.availableImages?.set(img.id, img);
      const files = extractFiles(msg?.files as unknown[] | undefined);
      for (const f of files) ctx.availableFiles?.set(f.id, f);

      return textResult({
        channel: channelId,
        ts: messageTs,
        text: text || "[attachment]",
        ...(imageFiles.length > 0 && { images: imageFiles.map((f) => ({ file_id: f.id, name: f.name })) }),
        ...(files.length > 0 && { files: files.map((f) => ({ file_id: f.id, name: f.name, type: f.mimetype })) }),
      });
    }
  );
}
