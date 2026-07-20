import { logger } from "../logger.js";
import { buildWildcardMatcher } from "./wildcardMatcher.js";

/**
 * The single Slack call this cache makes, narrowed from the full `App["client"]`. Stating the one
 * method it needs keeps the dependency honest and lets callers (tests included) supply a real
 * object rather than casting a stub through the whole WebClient surface.
 */
export interface EmojiListClient {
  emoji: {
    list: () => Promise<{ ok?: boolean; emoji?: { [name: string]: string }; error?: string }>;
  };
}

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
  /**
   * Exact-name lookup. Distinct from `search`, which is substring-based and would report a hit for
   * `party` whenever `partyparrot` exists — callers asking "does THIS emoji exist" need the exact
   * answer. Shares the same lazy fetch and TTL, so it costs no extra API call.
   */
  get(name: string): Promise<EmojiCacheEntry | undefined>;
  has(name: string): Promise<boolean>;
}

const TTL_MS = 60 * 60 * 1000; // 1 hour

export function createEmojiCache(client: EmojiListClient): EmojiCache {
  let cached: EmojiCacheEntry[] | null = null;
  let fetchedAt = 0;
  // Name index, rebuilt only when `fetchAll` hands back a different array (i.e. after a refetch),
  // so repeated exact lookups over one cached list stay O(1) instead of O(n) scans.
  let byName: Map<string, EmojiCacheEntry> | null = null;
  let byNameSource: EmojiCacheEntry[] | null = null;

  async function getByName(name: string): Promise<EmojiCacheEntry | undefined> {
    const emojis = await fetchAll();
    if (!byName || byNameSource !== emojis) {
      byName = new Map(emojis.map((entry) => [entry.name, entry]));
      byNameSource = emojis;
    }
    return byName.get(name);
  }

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

  return {
    get: getByName,

    async has(name: string) {
      return (await getByName(name)) !== undefined;
    },

    async search(query: string, limit = 25) {
      const emojis = await fetchAll();
      const match = buildWildcardMatcher(query);
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
