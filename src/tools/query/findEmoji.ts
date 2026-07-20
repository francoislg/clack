import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../helpers.js";
import { errorMessage } from "../../errors.js";
import type { EmojiCache, EmojiCacheEntry } from "../../slack/emojiCache.js";
import {
  listLore,
  loreNeedle,
  matchesLore,
  toCompactLore,
  type EmojiLoreEntry,
} from "../../emojiLore.js";

export interface FindEmojiDeps {
  listLore: typeof listLore;
}

export const defaultFindEmojiDeps: FindEmojiDeps = { listLore };

const DEFAULT_LIMIT = 25;
/** `lore_only` and `missing_lore` are index reads, not searches — the point is ONE call. */
const DEFAULT_INDEX_LIMIT = 200;

/** A search result, carrying workspace lore for the emojis that have it. */
interface FindEmojiResultEntry extends EmojiCacheEntry {
  lore?: {
    meaning: string;
    tags: string[];
    examples: EmojiLoreEntry["examples"];
    source: EmojiLoreEntry["source"];
    updatedAt: string;
  };
}

export function createFindEmojiTool(
  emojiCache: EmojiCache,
  deps: FindEmojiDeps = defaultFindEmojiDeps,
) {
  return tool(
    "find_emoji",
    "Search custom Slack workspace emojis. Matches BOTH emoji names and workspace lore — the recorded meaning/tags of emojis this workspace uses in a particular way — so you can search by intent ('approval', 'incident') and not just by name. Name matching is case-insensitive substring; use * as a wildcard (e.g. 'party*'), or '*' alone for everything. Results that carry `lore` tell you what the emoji actually means here; prefer those over guessing from a name. Three modes: default (search), lore_only: true (read the whole lore index compactly, to pick by meaning), and missing_lore: true (list emojis that have NO lore yet — the worklist for documenting them).",
    {
      query: z.string().describe("Search term to match against emoji names, lore meaning and tags"),
      limit: z
        .number()
        .optional()
        .describe("Maximum number of results (default: 25, or 200 for lore_only/missing_lore)"),
      lore_only: z
        .boolean()
        .optional()
        .describe(
          "Return ONLY emojis that have workspace lore, in compact form ({ name, meaning, tags }). Use with query '*' to read the full lore index in one call.",
        ),
      missing_lore: z
        .boolean()
        .optional()
        .describe(
          "Return the NAMES of workspace emojis that have no lore recorded yet. Use with query '*' for the full worklist. Cannot be combined with lore_only.",
        ),
      sort: z
        .enum(["oldest"])
        .optional()
        .describe(
          "'oldest' orders the lore_only index by least-recently-updated first, surfacing the stalest entries. Requires lore_only.",
        ),
    },
    async (args) => {
      try {
        if (args.lore_only && args.missing_lore) {
          return errorResult(
            "lore_only and missing_lore are opposites — lore_only returns emojis WITH lore, missing_lore returns those WITHOUT. Pick one.",
          );
        }
        if (args.sort && !args.lore_only) {
          return errorResult(
            "sort applies only to the lore_only index (it orders by lore age). Pass lore_only: true, or drop sort.",
          );
        }

        const lore = await deps.listLore();
        const needle = loreNeedle(args.query);
        const matchedLore = lore.filter((entry) => matchesLore(entry, needle));

        if (args.missing_lore) {
          const limit = args.limit ?? DEFAULT_INDEX_LIMIT;
          const documented = new Set(lore.map((entry) => entry.name));
          const undocumented = (await emojiCache.search(args.query, Number.MAX_SAFE_INTEGER)).emojis
            .filter((entry) => !documented.has(entry.name))
            .map((entry) => entry.name);
          return textResult({
            emojis: undocumented.slice(0, limit),
            total: undocumented.length,
            truncated: undocumented.length > limit,
          });
        }

        if (args.lore_only) {
          const limit = args.limit ?? DEFAULT_INDEX_LIMIT;
          const live: EmojiLoreEntry[] = [];
          for (const entry of matchedLore) {
            // Lore can outlive its emoji; the workspace list is the authority on what's postable.
            if (await emojiCache.has(entry.name)) live.push(entry);
          }
          // Sort before slicing so `limit: 1` yields the single stalest entry, not the first of
          // an arbitrary page. The compact projection still omits updatedAt — ordering by a field
          // doesn't require returning it.
          const ordered =
            args.sort === "oldest"
              ? [...live].sort((a, b) =>
                  a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : 0,
                )
              : live;
          return textResult({
            emojis: ordered.slice(0, limit).map(toCompactLore),
            total: ordered.length,
            truncated: ordered.length > limit,
          });
        }

        const limit = args.limit ?? DEFAULT_LIMIT;
        // Fetch the unpaged name matches so lore-first ranking reorders the WHOLE result set
        // rather than shuffling an already-truncated page.
        const nameMatches = (await emojiCache.search(args.query, Number.MAX_SAFE_INTEGER)).emojis;
        const loreByName = new Map(lore.map((entry) => [entry.name, entry]));

        const merged: FindEmojiResultEntry[] = [];
        const seen = new Set<string>();

        for (const entry of matchedLore) {
          const cached = await emojiCache.get(entry.name);
          if (!cached || seen.has(cached.name)) continue;
          seen.add(cached.name);
          merged.push(withLore(cached, entry));
        }
        for (const cached of nameMatches) {
          if (seen.has(cached.name)) continue;
          seen.add(cached.name);
          merged.push(withLore(cached, loreByName.get(cached.name)));
        }

        return textResult({
          emojis: merged.slice(0, limit),
          total: merged.length,
          truncated: merged.length > limit,
        });
      } catch (error) {
        return errorResult(`Failed to search emojis: ${errorMessage(error)}`);
      }
    },
  );
}

/**
 * Attach lore only when there is some — an emoji without lore must serialize exactly as it did
 * before this feature existed, so a workspace that never records lore sees no change at all.
 */
function withLore(
  cached: EmojiCacheEntry,
  entry: EmojiLoreEntry | undefined,
): FindEmojiResultEntry {
  if (!entry) return cached;
  return {
    ...cached,
    lore: {
      meaning: entry.meaning,
      tags: entry.tags,
      examples: entry.examples,
      source: entry.source,
      updatedAt: entry.updatedAt,
    },
  };
}
