import type { App } from "@slack/bolt";
import { getConfig } from "../../config.js";
import { logger } from "../../logger.js";
import { getErrorBlocks } from "../blocks.js";
import { isDev } from "../../roles.js";
import { resolveChannelLabel, resolveUserLabel, slackLink } from "../logContext.js";
import { extractMessageText } from "../messagesApi.js";
import { extractAttachments, type ExtractedAttachments } from "../fileExtractor.js";
import { processMessage } from "./core.js";

export interface NewQueryDeps {
  getConfig: typeof getConfig;
  processMessage: typeof processMessage;
  isDev: typeof isDev;
  extractMessageText: typeof extractMessageText;
}

export const defaultNewQueryDeps: NewQueryDeps = {
  getConfig,
  processMessage,
  isDev,
  extractMessageText,
};

interface ResolvedMessage extends ExtractedAttachments {
  text: string;
  threadTs?: string;
}

/**
 * Try to fetch a message via conversations.replies (works for parent messages and threads).
 */
async function fetchViaReplies(
  client: App["client"],
  channel: string,
  ts: string,
  deps: NewQueryDeps,
): Promise<ResolvedMessage | null> {
  try {
    const result = await client.conversations.replies({ channel, ts, inclusive: true, limit: 1 });
    const msg = result.messages?.[0];
    if (msg?.ts === ts) {
      logger.debug("Found message via conversations.replies (parent message)");
      return {
        text: deps.extractMessageText(msg),
        threadTs: msg.thread_ts || ts,
        ...extractAttachments(msg.files as unknown[] | undefined),
      };
    }
  } catch (error) {
    logger.debug("conversations.replies failed, trying history approach:", error);
  }
  return null;
}

/**
 * Fallback: fetch via conversations.history, then search in thread if needed.
 */
async function fetchViaHistory(
  client: App["client"],
  channel: string,
  ts: string,
  deps: NewQueryDeps,
): Promise<ResolvedMessage | null> {
  try {
    const histResult = await client.conversations.history({
      channel,
      latest: ts,
      inclusive: true,
      limit: 1,
    });
    const msg = histResult.messages?.[0];
    if (!msg) return null;

    if (msg.ts === ts) {
      logger.debug("Found message via conversations.history (channel message)");
      return {
        text: deps.extractMessageText(msg),
        threadTs: msg.thread_ts,
        ...extractAttachments(msg.files as unknown[] | undefined),
      };
    }

    // ts might be a thread reply — search the parent thread
    if (msg.thread_ts) {
      logger.debug(`Message not in channel history, searching in thread ${msg.thread_ts}`);
      const threadResult = await client.conversations.replies({
        channel,
        ts: msg.thread_ts,
        limit: 100,
      });
      const targetMsg = threadResult.messages?.find((m) => m.ts === ts);
      if (targetMsg) {
        logger.debug("Found message in thread replies");
        return {
          text: deps.extractMessageText(targetMsg),
          threadTs: msg.thread_ts,
          ...extractAttachments(targetMsg.files as unknown[] | undefined),
        };
      }
    }
  } catch (error) {
    logger.error("Error fetching message:", error);
  }
  return null;
}

/**
 * Resolve the message text and thread context for a reaction event.
 * reaction_added events don't include thread_ts, so multi-step lookup is needed.
 */
async function resolveReactedMessage(
  client: App["client"],
  channel: string,
  ts: string,
  deps: NewQueryDeps,
): Promise<ResolvedMessage | null> {
  return (
    (await fetchViaReplies(client, channel, ts, deps)) ??
    (await fetchViaHistory(client, channel, ts, deps))
  );
}

export function registerNewQueryHandler(app: App, deps: NewQueryDeps = defaultNewQueryDeps): void {
  const config = deps.getConfig();

  const workTrigger = config.reactions.changesWorkflow?.enabled
    ? config.reactions.changesWorkflow.trigger
    : null;

  app.event("reaction_added", async ({ event, client }) => {
    const userLabel = await resolveUserLabel(client, event.user);
    const channelLabel = await resolveChannelLabel(client, event.item.channel);
    logger.debug(
      `Reaction :${event.reaction}: from ${userLabel} in ${channelLabel}${await slackLink(client, event.item.channel, event.item.ts)}`,
    );

    const isWorkTrigger = workTrigger && event.reaction === workTrigger;
    const isQueryTrigger = event.reaction === config.reactions.trigger;

    if (!isWorkTrigger && !isQueryTrigger) {
      logger.debug(
        `Ignoring reaction ${event.reaction}, waiting for ${config.reactions.trigger}${workTrigger ? ` or ${workTrigger}` : ""}`,
      );
      return;
    }

    if (event.item.type !== "message") {
      logger.debug("Ignoring non-message reaction");
      return;
    }

    const { channel, ts } = event.item;
    const userId = event.user;

    const resolved = await resolveReactedMessage(client, channel, ts, deps);

    if (!resolved?.text) {
      await client.chat.postEphemeral({
        channel,
        user: userId,
        thread_ts: resolved?.threadTs || ts,
        text: "Sorry, I couldn't read the message. Make sure I'm invited to this channel.",
        blocks: getErrorBlocks(
          "Sorry, I couldn't read the message. Make sure I'm invited to this channel.",
        ),
      });
      return;
    }

    const workMode = isWorkTrigger ? await deps.isDev(userId) : false;

    await deps.processMessage({
      client,
      userId,
      channelId: channel,
      messageTs: ts,
      messageText: resolved.text,
      threadTs: resolved.threadTs,
      triggerType: "reactions",
      workMode,
      ...(resolved.imageFiles && { imageFiles: resolved.imageFiles }),
      ...(resolved.files && { files: resolved.files }),
    });
  });
}
