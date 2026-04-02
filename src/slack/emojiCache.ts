import type { App } from "@slack/bolt";
import { logger } from "../logger.js";

export interface EmojiCacheEntry {
  name: string;
  url: string;
  aliasFor?: string;
}

export interface EmojiCache {
  search(
    query: string,
    limit?: number,
  ): Promise<{ emojis: EmojiCacheEntry[]; total: number; truncated: boolean }>;
}

const TTL_MS = 60 * 60 * 1000; // 1 hour

export function createEmojiCache(client: App["client"]): EmojiCache {
  let cached: EmojiCacheEntry[] | null = null;
  let fetchedAt = 0;

  async function fetchAll(): Promise<EmojiCacheEntry[]> {
    if (cached && Date.now() - fetchedAt < TTL_MS) return cached;

    const result = await client.emoji.list();

    if (!result.ok || !result.emoji) {
      logger.error(`Failed to fetch emoji list: ${result.error}`);
      // Return stale cache if available, otherwise empty
      return cached ?? [];
    }

    const raw = result.emoji as Record<string, string>;
    const entries: EmojiCacheEntry[] = [];

    for (const [name, value] of Object.entries(raw)) {
      if (value.startsWith("alias:")) {
        const target = value.slice(6);
        const targetUrl = raw[target];
        entries.push({
          name,
          url: targetUrl && !targetUrl.startsWith("alias:") ? targetUrl : resolveAlias(raw, target),
          aliasFor: target,
        });
      } else {
        entries.push({ name, url: value });
      }
    }

    cached = entries;
    fetchedAt = Date.now();
    logger.debug(`EmojiCache: fetched and cached ${entries.length} emojis`);
    return cached;
  }

  function buildMatcher(query: string): (value: string) => boolean {
    if (query.includes("*")) {
      const escaped = query.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(`^${escaped.replace(/\*/g, ".*")}$`, "i");
      return (value) => pattern.test(value);
    }
    const lower = query.toLowerCase();
    return (value) => value.toLowerCase().includes(lower);
  }

  return {
    async search(query: string, limit = 25) {
      const emojis = await fetchAll();
      const match = buildMatcher(query);
      const matched: EmojiCacheEntry[] = [];

      for (const emoji of emojis) {
        if (match(emoji.name)) {
          matched.push(emoji);
        }
      }

      const total = matched.length;
      return {
        emojis: matched.slice(0, limit),
        total,
        truncated: total > limit,
      };
    },
  };
}

/** Resolve an alias chain to a final URL. */
function resolveAlias(raw: Record<string, string>, name: string, seen = new Set<string>()): string {
  if (seen.has(name)) return ""; // circular alias
  seen.add(name);
  const value = raw[name];
  if (!value) return "";
  if (value.startsWith("alias:")) return resolveAlias(raw, value.slice(6), seen);
  return value;
}
