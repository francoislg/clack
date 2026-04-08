import type { App } from "@slack/bolt";
import { logger } from "../logger.js";

export interface ChannelInfo {
  id: string;
  name: string;
  isDm?: boolean;
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
