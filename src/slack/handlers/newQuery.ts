import type { App } from "@slack/bolt";
import { getConfig } from "../../config.js";
import { logger } from "../../logger.js";
import { getErrorBlocks } from "../blocks.js";
import { isDev } from "../../roles.js";
import { extractMessageText } from "../messagesApi.js";
import { processMessage } from "./core.js";

interface ResolvedMessage {
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
): Promise<ResolvedMessage | null> {
  try {
    const result = await client.conversations.replies({ channel, ts, inclusive: true, limit: 1 });
    const msg = result.messages?.[0];
    if (msg?.ts === ts) {
      logger.debug("Found message via conversations.replies (parent message)");
      return { text: extractMessageText(msg), threadTs: msg.thread_ts || ts };
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
): Promise<ResolvedMessage | null> {
  try {
    const histResult = await client.conversations.history({ channel, latest: ts, inclusive: true, limit: 1 });
    const msg = histResult.messages?.[0];
    if (!msg) return null;

    if (msg.ts === ts) {
      logger.debug("Found message via conversations.history (channel message)");
      return { text: extractMessageText(msg), threadTs: msg.thread_ts };
    }

    // ts might be a thread reply — search the parent thread
    if (msg.thread_ts) {
      logger.debug(`Message not in channel history, searching in thread ${msg.thread_ts}`);
      const threadResult = await client.conversations.replies({ channel, ts: msg.thread_ts, limit: 100 });
      const targetMsg = threadResult.messages?.find((m) => m.ts === ts);
      if (targetMsg) {
        logger.debug("Found message in thread replies");
        return { text: extractMessageText(targetMsg), threadTs: msg.thread_ts };
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
): Promise<ResolvedMessage | null> {
  return (await fetchViaReplies(client, channel, ts)) ?? (await fetchViaHistory(client, channel, ts));
}

export function registerNewQueryHandler(app: App): void {
  const config = getConfig();

  const workTrigger = config.reactions.changesWorkflow?.enabled
    ? config.reactions.changesWorkflow.trigger
    : null;

  app.event("reaction_added", async ({ event, client }) => {
    logger.debug(`Reaction event: ${event.reaction} from ${event.user}`);

    const isWorkTrigger = workTrigger && event.reaction === workTrigger;
    const isQueryTrigger = event.reaction === config.reactions.trigger;

    if (!isWorkTrigger && !isQueryTrigger) {
      logger.debug(`Ignoring reaction ${event.reaction}, waiting for ${config.reactions.trigger}${workTrigger ? ` or ${workTrigger}` : ""}`);
      return;
    }

    if (event.item.type !== "message") {
      logger.debug("Ignoring non-message reaction");
      return;
    }

    const { channel, ts } = event.item;
    const userId = event.user;

    const resolved = await resolveReactedMessage(client, channel, ts);

    if (!resolved?.text) {
      await client.chat.postEphemeral({
        channel,
        user: userId,
        thread_ts: resolved?.threadTs || ts,
        text: "Sorry, I couldn't read the message. Make sure I'm invited to this channel.",
        blocks: getErrorBlocks("Sorry, I couldn't read the message. Make sure I'm invited to this channel."),
      });
      return;
    }

    const workMode = isWorkTrigger ? await isDev(userId) : false;

    await processMessage({
      client,
      userId,
      channelId: channel,
      messageTs: ts,
      messageText: resolved.text,
      threadTs: resolved.threadTs,
      triggerType: "reactions",
      workMode,
    });
  });
}
