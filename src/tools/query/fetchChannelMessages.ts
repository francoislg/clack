import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { extractMessageText } from "../../slack/messagesApi.js";
import { resolveUsers, transformUserMentions } from "../../slack/userCache.js";

export function createFetchChannelMessagesTool(ctx: QueryToolContext) {
  return tool(
    "fetch_channel_messages",
    "Fetch recent messages from a Slack channel. Use this when you need to read what's being discussed in a channel — for example, when a user in an assistant thread asks about messages in the channel they're viewing.",
    {
      channel_id: z.string().describe("Slack channel ID (e.g. C0123456789)"),
      limit: z.number().optional().describe("Number of messages to fetch (default: 20, max: 100)"),
      oldest: z.string().optional().describe("Only messages after this Unix timestamp (e.g. '1234567890.123456')"),
      latest: z.string().optional().describe("Only messages before this Unix timestamp (e.g. '1234567890.123456')"),
      include_threads: z.boolean().optional().describe("Whether to fetch thread replies for each message (default: false). Slower but gives full context."),
    },
    async (args) => {
      const client = ctx.slackClient!;
      const limit = Math.min(args.limit ?? 20, 100);

      try {
        const result = await client.conversations.history({
          channel: args.channel_id,
          limit,
          ...(args.oldest ? { oldest: args.oldest } : {}),
          ...(args.latest ? { latest: args.latest } : {}),
          inclusive: true,
        });

        if (!result.messages || result.messages.length === 0) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ channel: args.channel_id, messages: [], message_count: 0 }) }],
          };
        }

        // Resolve user names for all messages
        const userIds = result.messages
          .map((msg) => msg.user || msg.bot_id)
          .filter((id): id is string => !!id);
        const userInfoMap = await resolveUsers(client, userIds);

        // Process messages (conversations.history returns newest-first, reverse for chronological)
        const messages = [];
        for (const msg of [...result.messages].reverse()) {
          if (!msg.ts) continue;

          const userId = msg.user || msg.bot_id;
          const userInfo = userId ? userInfoMap.get(userId) : undefined;
          const text = await transformUserMentions(client, extractMessageText(msg) || "[attachment]");

          const entry: Record<string, unknown> = {
            user: userInfo?.displayName ?? userInfo?.username ?? userId ?? "unknown",
            text,
            ts: msg.ts,
            is_bot: msg.bot_id !== undefined,
          };

          if (msg.reply_count && msg.reply_count > 0) {
            entry.reply_count = msg.reply_count;
          }

          // Optionally fetch thread replies
          if (args.include_threads && msg.reply_count && msg.reply_count > 0 && msg.ts) {
            try {
              const threadResult = await client.conversations.replies({
                channel: args.channel_id,
                ts: msg.ts,
                limit: 50,
              });

              if (threadResult.messages && threadResult.messages.length > 1) {
                // Skip the parent (first message), only include replies
                const replies = [];
                for (const reply of threadResult.messages.slice(1)) {
                  const replyUserId = reply.user || reply.bot_id;
                  const replyUserInfo = replyUserId ? userInfoMap.get(replyUserId) : undefined;

                  // Resolve reply user if not in the initial batch
                  let replyName = replyUserInfo?.displayName ?? replyUserInfo?.username ?? replyUserId;
                  if (!replyUserInfo && replyUserId) {
                    const extraMap = await resolveUsers(client, [replyUserId]);
                    const extra = extraMap.get(replyUserId);
                    if (extra) replyName = extra.displayName ?? extra.username ?? replyUserId;
                  }

                  replies.push({
                    user: replyName ?? "unknown",
                    text: await transformUserMentions(client, extractMessageText(reply) || "[attachment]"),
                    ts: reply.ts,
                    is_bot: reply.bot_id !== undefined,
                  });
                }
                entry.thread_replies = replies;
              }
            } catch {
              // Thread fetch failed — include what we have
              entry.thread_error = "Failed to fetch thread replies";
            }
          }

          messages.push(entry);
        }

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              channel: args.channel_id,
              message_count: messages.length,
              has_more: result.has_more ?? false,
              messages,
            }),
          }],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: `Failed to fetch channel messages: ${errorMessage}` }) }],
        };
      }
    }
  );
}
