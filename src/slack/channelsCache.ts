import { logger } from "../logger.js";
import { buildWildcardMatcher } from "./wildcardMatcher.js";

export interface SlackChannelEntry {
  id: string;
  name: string;
  isPrivate: boolean;
  isArchived: boolean;
  topic?: string;
  purpose?: string;
  numMembers?: number;
}

export interface ChannelsCache {
  search(
    query: string,
    options?: { scope?: "all" | "public" | "private"; includeArchived?: boolean; limit?: number },
  ): Promise<SlackChannelEntry[]>;
  resolve(idOrName: string): Promise<SlackChannelEntry | null>;
}

interface ChannelApiResult {
  id?: string;
  name?: string;
  is_private?: boolean;
  is_archived?: boolean;
  topic?: { value?: string };
  purpose?: { value?: string };
  num_members?: number;
}

/** Narrow client interface for testability. The real `App["client"]` satisfies this. */
export interface ChannelsCacheClient {
  conversations: {
    list: (args: {
      types: string;
      exclude_archived: boolean;
      limit: number;
      cursor?: string;
    }) => Promise<{
      ok?: boolean;
      error?: string;
      channels?: ChannelApiResult[];
      response_metadata?: { next_cursor?: string };
    }>;
    info: (args: { channel: string }) => Promise<{
      ok?: boolean;
      channel?: ChannelApiResult;
    }>;
  };
}

export function createChannelsCache(client: ChannelsCacheClient): ChannelsCache {
  let cached: SlackChannelEntry[] | null = null;

  async function fetchAll(): Promise<SlackChannelEntry[]> {
    if (cached) return cached;

    const channels: SlackChannelEntry[] = [];
    let cursor: string | undefined;

    do {
      const result = await client.conversations.list({
        types: "public_channel,private_channel",
        exclude_archived: false,
        limit: 1000,
        cursor,
      });

      if (!result.ok || !result.channels) {
        logger.error(`Failed to fetch channels list: ${result.error}`);
        break;
      }

      for (const ch of result.channels) {
        if (!ch.id || !ch.name) continue;
        channels.push({
          id: ch.id,
          name: ch.name,
          isPrivate: ch.is_private ?? false,
          isArchived: ch.is_archived ?? false,
          ...(ch.topic?.value && { topic: ch.topic.value }),
          ...(ch.purpose?.value && { purpose: ch.purpose.value }),
          ...(ch.num_members != null && { numMembers: ch.num_members }),
        });
      }

      cursor = result.response_metadata?.next_cursor || undefined;
    } while (cursor);

    cached = channels;
    logger.debug(`ChannelsCache: fetched and cached ${channels.length} channels`);
    return cached;
  }

  return {
    async search(query, options = {}): Promise<SlackChannelEntry[]> {
      const { scope = "all", includeArchived = false, limit = 20 } = options;
      const channels = await fetchAll();
      const searchName = query.replace(/^#/, "");
      const matches = buildWildcardMatcher(searchName);
      const results: SlackChannelEntry[] = [];

      for (const ch of channels) {
        if (!includeArchived && ch.isArchived) continue;
        if (scope === "public" && ch.isPrivate) continue;
        if (scope === "private" && !ch.isPrivate) continue;
        if (!matches(ch.name)) continue;
        results.push(ch);
        if (results.length >= limit) break;
      }

      return results;
    },

    async resolve(idOrName: string): Promise<SlackChannelEntry | null> {
      const input = idOrName.trim();
      if (!input) return null;

      // Direct ID lookup — check cache first, fall back to API
      if (/^[CG][A-Z0-9_]+$/.test(input)) {
        const channels = await fetchAll();
        const found = channels.find((ch) => ch.id === input);
        if (found) return found;

        // Not in cache (might be a channel bot just joined) — try API
        try {
          const result = await client.conversations.info({ channel: input });
          if (!result.ok || !result.channel) return null;
          const ch = result.channel;
          return {
            id: ch.id ?? input,
            name: ch.name ?? input,
            isPrivate: ch.is_private ?? false,
            isArchived: ch.is_archived ?? false,
            ...(ch.topic?.value && { topic: ch.topic.value }),
            ...(ch.purpose?.value && { purpose: ch.purpose.value }),
            ...(ch.num_members != null && { numMembers: ch.num_members }),
          };
        } catch {
          return null;
        }
      }

      // Name lookup
      const channels = await fetchAll();
      const name = input.replace(/^#/, "").toLowerCase();
      return channels.find((ch) => ch.name.toLowerCase() === name) ?? null;
    },
  };
}
