import type { App } from "@slack/bolt";
import { getConfig } from "../../config.js";
import { logger } from "../../logger.js";
import { resolveChannelLabel, resolveUserLabel, slackLink } from "../logContext.js";
import { stopThread, type StopResult } from "../stopPipeline.js";

export type StopThreadFn = (
  channelId: string,
  threadTs: string,
  triggeredByUserId: string,
  reason: string,
) => Promise<StopResult>;

export type ResolveThreadTsFn = (
  client: App["client"],
  channel: string,
  ts: string,
) => Promise<string>;

export interface StopReactionDeps {
  getConfig: typeof getConfig;
  stopThread: StopThreadFn;
  resolveThreadTs: ResolveThreadTsFn;
}

/**
 * Resolve the `thread_ts` for a message that was reacted to. Reaction events
 * don't include `thread_ts`, so we fetch the message and read it. Falls back
 * to the message's own ts if it isn't part of a thread.
 */
async function defaultResolveThreadTs(
  client: App["client"],
  channel: string,
  ts: string,
): Promise<string> {
  try {
    const replies = await client.conversations.replies({ channel, ts, inclusive: true, limit: 1 });
    const msg = replies.messages?.[0];
    if (msg?.ts === ts) {
      return msg.thread_ts || ts;
    }
  } catch (error) {
    logger.debug("stopReaction: conversations.replies failed, trying history", error);
  }

  try {
    const history = await client.conversations.history({
      channel,
      latest: ts,
      inclusive: true,
      limit: 1,
    });
    const msg = history.messages?.[0];
    if (msg?.ts === ts) {
      return msg.thread_ts || ts;
    }
  } catch (error) {
    logger.debug("stopReaction: conversations.history failed", error);
  }

  return ts;
}

export const defaultStopReactionDeps: StopReactionDeps = {
  getConfig,
  stopThread,
  resolveThreadTs: defaultResolveThreadTs,
};

export function registerStopReactionHandler(
  app: App,
  deps: StopReactionDeps = defaultStopReactionDeps,
): void {
  app.event("reaction_added", async ({ event, client }) => {
    const stopEmoji = deps.getConfig().reactions.stop;
    if (!stopEmoji) return;
    if (event.reaction !== stopEmoji) return;
    if (event.item.type !== "message") return;

    const channel = event.item.channel;
    const messageTs = event.item.ts;
    const threadTs = await deps.resolveThreadTs(client, channel, messageTs);

    // Resolve friendly log context, best-effort — never let logging side-effects
    // block the actual stop behaviour.
    try {
      const userLabel = await resolveUserLabel(client, event.user);
      const channelLabel = await resolveChannelLabel(client, channel);
      const threadLink = await slackLink(client, channel, threadTs);
      logger.info(`Stop reaction :${stopEmoji}: from ${userLabel} in ${channelLabel}${threadLink}`);
    } catch (err) {
      logger.debug(`stopReaction: log context resolution failed: ${err}`);
    }

    await deps.stopThread(channel, threadTs, event.user, "stopped via reaction");
  });
}
