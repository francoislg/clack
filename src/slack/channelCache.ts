import type { App } from "@slack/bolt";
import { isChannellessChannelId } from "../channelless.js";
import { logger } from "../logger.js";

export interface ChannelInfo {
  id: string;
  name: string;
  isDm?: boolean;
  /** True if the channel is private. Undefined for DMs. */
  isPrivate?: boolean;
  /** The channel's Slack purpose text. Omitted when absent or empty. */
  purpose?: string;
}

const channelCache = new Map<string, ChannelInfo>();

/**
 * Get channel info from cache or fetch from Slack API.
 * DM channels (D-prefixed) are detected by prefix to avoid unnecessary API calls.
 * Returns undefined if the channel cannot be resolved.
 */
export async function getChannelInfo(
  client: App["client"],
  channelId: string,
): Promise<ChannelInfo | undefined> {
  const cached = channelCache.get(channelId);
  if (cached) {
    return cached;
  }

  // Channelless cron dispatch synthesizes a `channelless:<jobId>` sentinel that is not a
  // real Slack channel — skip the API call (it would 404 with channel_not_found).
  if (isChannellessChannelId(channelId)) {
    return undefined;
  }

  // DM channels start with D — skip the API call
  if (channelId.startsWith("D")) {
    const info: ChannelInfo = { id: channelId, name: "DM", isDm: true };
    channelCache.set(channelId, info);
    return info;
  }

  try {
    const result = await client.conversations.info({ channel: channelId });

    if (!result.ok || !result.channel) {
      logger.debug(`Failed to fetch channel info for ${channelId}: ${result.error}`);
      return undefined;
    }

    const channelInfo: ChannelInfo = {
      id: channelId,
      name: result.channel.name ?? channelId,
    };
    if (typeof result.channel.is_private === "boolean") {
      channelInfo.isPrivate = result.channel.is_private;
    }
    const purpose = result.channel.purpose?.value;
    if (purpose) {
      channelInfo.purpose = purpose;
    }

    channelCache.set(channelId, channelInfo);
    logger.debug(`Cached channel info for ${channelId}: #${channelInfo.name}`);

    return channelInfo;
  } catch (error) {
    logger.error(`Error fetching channel info for ${channelId}:`, error);
    return undefined;
  }
}

/**
 * Clear the channel cache. Useful for testing.
 */
export function clearChannelCache(): void {
  channelCache.clear();
}
