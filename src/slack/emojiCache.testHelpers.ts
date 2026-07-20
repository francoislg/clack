import { buildWildcardMatcher } from "./wildcardMatcher.js";
import type { EmojiCache, EmojiCacheEntry } from "./emojiCache.js";

/**
 * The canonical {@link EmojiCache} fake: a workspace with exactly these emoji names. Matching is
 * the REAL behavior (`buildWildcardMatcher` for `search`, exact lookup for `get`/`has`) — only the
 * Slack fetch is faked away, so a test can never pass against matching semantics the production
 * cache does not have.
 */
export function createFakeEmojiCache(names: string[]): EmojiCache {
  const entries = new Map<string, EmojiCacheEntry>(
    names.map((name) => [name, { name, url: `https://emoji.test/${name}.png` }]),
  );
  return {
    async get(name) {
      return entries.get(name);
    },
    async has(name) {
      return entries.has(name);
    },
    async search(query, limit = 25) {
      const match = buildWildcardMatcher(query);
      const matched = [...entries.values()].filter((entry) => match(entry.name));
      return {
        emojis: matched.slice(0, limit),
        total: matched.length,
        truncated: matched.length > limit,
      };
    },
  };
}
