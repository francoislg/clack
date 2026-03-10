import type { App } from "@slack/bolt";
import { Assistant } from "@slack/bolt";
import { logger } from "../../logger.js";
import { findSessionByThread, updateSession } from "../../sessions.js";
import { processMessage } from "./core.js";

/**
 * Fetch the assistant thread context (channel_id the user is viewing) by reading
 * metadata from the bot's initial message in the thread. This is more reliable than
 * Bolt's in-memory DefaultThreadContextStore which is lost on restart.
 */
async function fetchAssistantContext(
  client: App["client"],
  channel: string,
  threadTs: string,
  botUserId: string,
): Promise<{ channel_id?: string } | null> {
  try {
    const result = await client.conversations.replies({
      channel,
      ts: threadTs,
      oldest: threadTs,
      include_all_metadata: true,
      limit: 4,
    });
    if (!result.messages) return null;
    const botMsg = result.messages.find((m) => !("subtype" in m) && m.user === botUserId);
    const payload = botMsg?.metadata?.event_payload as Record<string, unknown> | undefined;
    if (payload?.channel_id && typeof payload.channel_id === "string") {
      return { channel_id: payload.channel_id };
    }
    return null;
  } catch (err) {
    logger.debug(`Failed to fetch assistant thread context: ${err}`);
    return null;
  }
}

export function registerAssistant(app: App): void {
  const assistant = new Assistant({
    threadStarted: async ({ event, say, saveThreadContext, setSuggestedPrompts }) => {
      const ctx = event.assistant_thread?.context;
      logger.debug(`Assistant threadStarted: channel_id=${ctx?.channel_id ?? "none"}`);

      // The default context store attaches context metadata to a bot message.
      // Without say(), saveThreadContext() has no message to attach to and silently no-ops.
      await say("Hi! Ask me anything about the codebase.");
      await saveThreadContext();

      const prompts: Array<{ title: string; message: string }> = [];

      // If a channel context is available, suggest reviewing recent messages
      if (ctx?.channel_id) {
        prompts.push({
          title: "Check recent messages",
          message: "Check the recent messages in the channel and summarize what's being discussed",
        });
      }

      prompts.push(
        { title: "Debug something", message: "Help me debug something in the codebase" },
        { title: "Tell me something funny", message: "Tell me something funny about the codebase" },
      );

      await setSuggestedPrompts({ prompts });
    },

    threadContextChanged: async ({ event, saveThreadContext }) => {
      const ctx = event.assistant_thread?.context;
      const channelId = ctx?.channel_id as string | undefined;
      logger.debug(`Assistant context changed: channel_id=${channelId}`);
      await saveThreadContext();

      // Update assistantCurrentChannelId on existing session if one exists
      if (channelId && event.assistant_thread?.channel_id && event.assistant_thread?.thread_ts) {
        const session = await findSessionByThread(
          event.assistant_thread.channel_id,
          event.assistant_thread.thread_ts,
        );
        if (session) {
          await updateSession(session.sessionId, { assistantCurrentChannelId: channelId });
        }
      }
    },

    userMessage: async ({ event, client, setStatus, setTitle, getThreadContext }) => {
      const msg = event as unknown as {
        text?: string;
        user?: string;
        channel: string;
        ts: string;
        thread_ts?: string;
      };

      if (!msg.user || !msg.text) return;

      await setStatus("Thinking...");

      // Try Bolt's in-memory context store first (works when threadStarted fired in this process)
      let contextChannelId: string | undefined;
      const threadContext = await getThreadContext();
      contextChannelId = (threadContext?.channel_id as string) || undefined;

      // Fallback: read metadata from the bot's first message (survives restarts)
      if (!contextChannelId && msg.thread_ts) {
        const auth = await client.auth.test();
        const botUserId = auth.user_id || "";
        const stored = await fetchAssistantContext(client, msg.channel, msg.thread_ts, botUserId);
        contextChannelId = stored?.channel_id;
      }

      // Last resort: check existing session for previously saved assistant channel
      if (!contextChannelId && msg.thread_ts) {
        const existing = await findSessionByThread(msg.channel, msg.thread_ts);
        contextChannelId = existing?.assistantCurrentChannelId;
      }

      logger.info(`Assistant userMessage: contextChannelId=${contextChannelId ?? "none"}`);

      // Process the message through the standard flow
      await processMessage({
        client,
        userId: msg.user,
        channelId: msg.channel,
        messageTs: msg.ts,
        messageText: msg.text,
        threadTs: msg.thread_ts,
        triggerType: "directMessages",
        assistantChannelId: contextChannelId,
      });

      // Set thread title from the user's question
      const title = msg.text.length > 50
        ? msg.text.substring(0, 47) + "..."
        : msg.text;
      try {
        await setTitle(title);
      } catch (err) {
        logger.debug(`Failed to set assistant thread title: ${err}`);
      }
    },
  });

  app.assistant(assistant);
  logger.debug("Registered Slack Assistant");
}
