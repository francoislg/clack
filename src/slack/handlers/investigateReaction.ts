import type { App } from "@slack/bolt";
import { getConfig } from "../../config.js";
import { logger } from "../../logger.js";
import { t } from "../../i18n/t.js";
import { getOwnerUserId, sendOwnerDm } from "../ownerDm.js";
import { bootstrapInvestigation } from "../../investigations/engine.js";

type SlackClient = App["client"];

export interface InvestigateReactionDeps {
  getConfig: typeof getConfig;
  bootstrapInvestigation: typeof bootstrapInvestigation;
  getOwnerUserId: typeof getOwnerUserId;
  sendOwnerDm: typeof sendOwnerDm;
}

export const defaultInvestigateReactionDeps: InvestigateReactionDeps = {
  getConfig,
  bootstrapInvestigation,
  getOwnerUserId,
  sendOwnerDm,
};

/**
 * Resolves the origin thread's ts from a reacted message.
 * If the message is a thread reply, returns its thread_ts.
 * Otherwise returns the message's ts itself.
 */
async function resolveOriginThreadTs(
  client: SlackClient,
  channel: string,
  ts: string,
): Promise<string | null> {
  try {
    const result = await client.conversations.replies({
      channel,
      ts,
      inclusive: true,
      limit: 1,
    });
    const msg = result.messages?.[0];
    if (msg?.ts === ts) {
      return msg.thread_ts || ts;
    }
  } catch (error) {
    logger.debug("conversations.replies failed, trying history approach:", error);
  }

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
      return msg.thread_ts || ts;
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
        return msg.thread_ts;
      }
    }
  } catch (error) {
    logger.error("Error resolving origin thread ts:", error);
  }

  return null;
}

export async function handleInvestigateReaction(
  event: {
    reaction: string;
    user: string;
    item: { type: string; channel: string; ts: string };
  },
  client: SlackClient,
  deps: InvestigateReactionDeps = defaultInvestigateReactionDeps,
): Promise<void> {
  const config = deps.getConfig();

  // Gate 1: investigations not enabled
  if (!config.investigations?.enabled) {
    logger.debug("investigations: feature disabled");
    return;
  }

  // Gate 2: wrong emoji
  if (event.reaction !== config.investigations.emoji) {
    logger.debug(
      `ignoring reaction :${event.reaction}:, waiting for ${config.investigations.emoji}`,
    );
    return;
  }

  // Gate 3: non-message reaction
  if (event.item.type !== "message") {
    logger.debug("investigations: ignoring non-message reaction");
    return;
  }

  const { channel, ts } = event.item;
  const userId = event.user;

  logger.debug(`investigations: processing investigate reaction from ${userId} in ${channel}`);

  const originThreadTs = await resolveOriginThreadTs(client, channel, ts);
  if (!originThreadTs) {
    logger.warn(`investigations: could not resolve origin thread ts for ${channel}:${ts}`);
    await client.chat.postEphemeral({
      channel,
      user: userId,
      text: t("investigations.reactor_resolve_failed"),
    });
    return;
  }

  const result = await deps.bootstrapInvestigation({
    client,
    surface: "channel",
    originChannel: channel,
    originThreadTs,
    requester: userId,
    originMode: "followAndInteract",
  });

  switch (result.status) {
    case "ok": {
      const link = result.permalink ?? `<#${result.mainChannel}>`;
      await client.chat.postEphemeral({
        channel,
        user: userId,
        text: t("investigations.reactor_started", { link }),
      });
      // Join failed on a public origin channel → degraded to passive follow. Note the owner.
      if (result.degraded) {
        const ownerUserId = await deps.getOwnerUserId();
        if (ownerUserId) {
          await deps.sendOwnerDm(
            ownerUserId,
            t("investigations.owner_degraded", { link: `<#${channel}>` }),
          );
        }
      }
      break;
    }

    case "duplicate": {
      const link = result.permalink ?? "the existing investigation";
      await client.chat.postEphemeral({
        channel,
        user: userId,
        text: t("investigations.reactor_duplicate", { link }),
      });
      break;
    }

    case "channel_not_configured": {
      const ownerUserId = await deps.getOwnerUserId();
      if (ownerUserId) {
        await deps.sendOwnerDm(
          ownerUserId,
          t("investigations.owner_unconfigured", { user: `<@${userId}>` }),
        );
      }
      await client.chat.postEphemeral({
        channel,
        user: userId,
        text: t("investigations.reactor_unconfigured"),
      });
      break;
    }

    case "cycle": {
      await client.chat.postEphemeral({
        channel,
        user: userId,
        text: t("investigations.reactor_cycle"),
      });
      break;
    }

    case "dm_failed": {
      logger.warn("investigations: dm surface bootstrap failed");
      break;
    }
  }
}

export function registerInvestigateReactionHandler(app: App): void {
  app.event("reaction_added", async ({ event, client }) => {
    try {
      await handleInvestigateReaction(event, client);
    } catch (err) {
      logger.error("Error in investigateReaction handler:", err);
    }
  });
}
