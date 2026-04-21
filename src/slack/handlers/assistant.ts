import type { App, AssistantConfig } from "@slack/bolt";
import { Assistant } from "@slack/bolt";
import { getConfig } from "../../config.js";
import { logger } from "../../logger.js";
import { findSessionByThread, updateSession, type SessionContext } from "../../sessions.js";
import { extractAttachments, type ExtractedAttachments } from "../fileExtractor.js";
import { PerThreadContextStore } from "./assistantContextStore.js";
import { processMessage } from "./core.js";
import { matchesInlineStopEmoji } from "../stopEmoji.js";
import { stopThread, type StopResult } from "../stopPipeline.js";

type AssistantConstructor = new (handlers: AssistantConfig) => Assistant;

export interface AssistantDeps {
  Assistant: AssistantConstructor;
  getConfig: () => {
    directMessages: { enabled: boolean };
    reactions?: { stop?: string | null };
  };
  findSessionByThread: (channelId: string, threadTs: string) => Promise<SessionContext | null>;
  updateSession: (
    sessionId: string,
    updates: { assistantCurrentChannelId: string },
  ) => Promise<SessionContext | null>;
  stopThread: (
    channelId: string,
    threadTs: string,
    triggeredByUserId: string,
    reason: string,
  ) => Promise<StopResult>;
  processMessage: typeof processMessage;
  extractAttachments: (files: unknown[] | undefined) => ExtractedAttachments;
}

export const defaultAssistantDeps: AssistantDeps = {
  Assistant,
  getConfig,
  findSessionByThread,
  updateSession,
  processMessage,
  extractAttachments,
  stopThread,
};

/**
 * Fetch the assistant thread context (channel_id the user is viewing) by reading
 * metadata from the bot's initial message in the thread. This is more reliable than
 * Bolt's in-memory DefaultThreadContextStore which is lost on restart.
 */
/** @internal Exported for testing only */
export async function fetchAssistantContext(
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

/** @internal Exported for testing only */
export async function resolveContextChannelId(
  client: App["client"],
  msg: { channel: string; thread_ts?: string },
  getThreadContext: () => Promise<{ channel_id?: string } | undefined>,
  deps: Pick<AssistantDeps, "findSessionByThread"> = defaultAssistantDeps,
): Promise<string | undefined> {
  // Try Bolt's in-memory context store first
  const threadContext = await getThreadContext();
  const fromStore = threadContext?.channel_id || undefined;
  if (fromStore) return fromStore;

  // Fallback: read metadata from the bot's first message (survives restarts)
  if (msg.thread_ts) {
    const auth = await client.auth.test();
    const botUserId = auth.user_id || "";
    const stored = await fetchAssistantContext(client, msg.channel, msg.thread_ts, botUserId);
    if (stored?.channel_id) return stored.channel_id;
  }

  // Last resort: check existing session
  if (msg.thread_ts) {
    const existing = await deps.findSessionByThread(msg.channel, msg.thread_ts);
    return existing?.assistantCurrentChannelId;
  }
  return undefined;
}

interface AssistantEventMessage {
  text?: string;
  user?: string;
  channel: string;
  ts: string;
  thread_ts?: string;
  files?: object[];
}

interface RawAssistantEvent {
  channel?: unknown;
  ts?: unknown;
  user?: unknown;
  text?: unknown;
  thread_ts?: unknown;
  files?: unknown;
}

function toAssistantEventMessage<T extends object>(value: T): AssistantEventMessage | null {
  const e = value as RawAssistantEvent;
  if (typeof e.channel !== "string") return null;
  if (typeof e.ts !== "string") return null;
  return {
    channel: e.channel,
    ts: e.ts,
    user: typeof e.user === "string" ? e.user : undefined,
    text: typeof e.text === "string" ? e.text : undefined,
    thread_ts: typeof e.thread_ts === "string" ? e.thread_ts : undefined,
    files: Array.isArray(e.files) ? (e.files as object[]) : undefined,
  };
}

export function registerAssistant(app: App, deps: AssistantDeps = defaultAssistantDeps): void {
  const assistant = new deps.Assistant({
    threadContextStore: new PerThreadContextStore(),
    threadStarted: async ({ event, say, saveThreadContext, setSuggestedPrompts }) => {
      if (!deps.getConfig().directMessages.enabled) return;
      const ctx = event.assistant_thread?.context;
      logger.debug(`Assistant threadStarted: channel_id=${ctx?.channel_id ?? "none"}`);

      await say("Hi! Ask me anything about the codebase.");
      await saveThreadContext();

      const prompts: Array<{ title: string; message: string }> = [];
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
      const channelId = event.assistant_thread?.context?.channel_id as string | undefined;
      logger.debug(`Assistant context changed: channel_id=${channelId}`);
      await saveThreadContext();

      if (channelId && event.assistant_thread?.channel_id && event.assistant_thread?.thread_ts) {
        const session = await deps.findSessionByThread(
          event.assistant_thread.channel_id,
          event.assistant_thread.thread_ts,
        );
        if (session) {
          await deps.updateSession(session.sessionId, { assistantCurrentChannelId: channelId });
        }
      }
    },

    userMessage: async ({ event, client, setStatus, setTitle, getThreadContext }) => {
      if (!deps.getConfig().directMessages.enabled) return;
      const msg = toAssistantEventMessage(event);
      if (!msg?.user) return;

      const attachments = deps.extractAttachments(msg.files);
      const hasText = !!msg.text;
      const hasImages = !!attachments.imageFiles?.length;
      if (!hasText && !hasImages) return;

      const config = deps.getConfig();
      if (matchesInlineStopEmoji(msg.text, config.reactions?.stop)) {
        const threadTs = msg.thread_ts || msg.ts;
        logger.info(
          `Inline stop emoji in DM thread from ${msg.user} in ${msg.channel} (thread ${threadTs})`,
        );
        await deps.stopThread(msg.channel, threadTs, msg.user, "stopped via inline emoji");
        return;
      }

      await setStatus("Thinking...");

      const contextChannelId = await resolveContextChannelId(client, msg, getThreadContext, deps);

      const messageText = hasText ? msg.text! : "Answer based on the attached image(s).";

      await deps.processMessage({
        client,
        userId: msg.user,
        channelId: msg.channel,
        messageTs: msg.ts,
        messageText,
        threadTs: msg.thread_ts,
        triggerType: "directMessages",
        assistantChannelId: contextChannelId,
        ...attachments,
      });

      const title = messageText.length > 50 ? messageText.substring(0, 49) + "…" : messageText;
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
