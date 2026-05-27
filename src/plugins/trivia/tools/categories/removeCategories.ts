import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../../../tools/helpers.js";
import { findCurrentSeason, findSeasonBySlug } from "../../core/seasonTimeline.js";
import { defaultGetGames, type GetGamesFn } from "../../core/configBridge.js";
import { requireGame } from "../../core/gamesRegistry.js";
import type { TriviaDataLayer, SeasonsState } from "../../core/types.js";

function removeMatches(
  list: string[],
  toRemove: string[],
): { removed: string[]; notFound: string[]; next: string[] } {
  const next = [...list];
  const lower = next.map((c) => c.toLowerCase());
  const removed: string[] = [];
  const notFound: string[] = [];
  for (const category of toRemove) {
    const idx = lower.indexOf(category.toLowerCase());
    if (idx >= 0) {
      removed.push(next[idx]);
      next.splice(idx, 1);
      lower.splice(idx, 1);
    } else {
      notFound.push(category);
    }
  }
  return { removed, notFound, next };
}

function replaceSeasonCategories(state: SeasonsState, slug: string, next: string[]): SeasonsState {
  return {
    seasons: state.seasons.map((s) => (s.slug === slug ? { ...s, categories: next } : s)),
  };
}

/**
 * Drop the `categories` field from the named season. Used when a remove operation
 * empties a season's pool — instead of erroring, we clear the field so the season
 * participates in the cascade (`slot → season → game → global`).
 */
function omitSeasonCategories(state: SeasonsState, slug: string): SeasonsState {
  return {
    seasons: state.seasons.map((s) => {
      if (s.slug !== slug) return s;
      const { categories: _omitted, ...rest } = s;
      return rest;
    }),
  };
}

export function createRemoveCategoriesTool(
  data: TriviaDataLayer,
  getGamesFn: GetGamesFn = defaultGetGames,
) {
  return tool(
    "remove_categories",
    "Remove categories from the trivia category pool. The `game` argument scopes any season-targeted writes to that game's seasons.json. The global `categories.json` (target \"default\") is the cascade floor and cannot be emptied — removals that would leave it empty are rejected. Season-level removals (current or specific slug) that would leave the season's `categories` array empty cause the field to be DROPPED from that season entry — the season then participates in the cascade (`slot → season → game → global`). When that happens the response carries a `cleared` marker (e.g. `cleared: { current: true }`) and the corresponding `totals` entry is `0`.",
    {
      game: z
        .string()
        .describe(
          "Game name (must be present in config.trivia.games[]). Season-targeted writes apply to this game's seasons.json.",
        ),
      categories: z.array(z.string()).describe("Categories to remove from the pool"),
      target: z
        .string()
        .optional()
        .describe(
          'Where to remove from. "current" (default): this game\'s currently-active season. "default": global categories.json. "both": current + default. Any other string: that season slug within this game.',
        ),
    },
    async (args) => {
      try {
        requireGame(getGamesFn(), args.game);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }

      const scoped = data.forGame(args.game);
      const seasonsState = await scoped.loadSeasonsState();

      if (seasonsState === null) {
        const existing = await data.loadCategories();
        const { removed, notFound, next } = removeMatches(existing, args.categories);
        if (removed.length > 0 && next.length === 0) {
          return errorResult(
            "Refusing to remove: the global categories.json is the cascade floor and cannot be emptied. Add at least one category first.",
          );
        }
        if (removed.length > 0) await data.saveCategories(next);
        return textResult({ removed, notFound, total: next.length });
      }

      const target = args.target ?? "both";

      if (target !== "current" && target !== "default" && target !== "both") {
        const entry = findSeasonBySlug(seasonsState, target);
        if (entry === null) {
          return errorResult(`No season with slug "${target}" on this game's timeline.`);
        }
        if (entry.categories === undefined) {
          return textResult({
            target,
            removed: [],
            notFound: args.categories,
            total: 0,
            warning: `Season "${target}" already inherits its categories from the cascade — nothing to remove.`,
          });
        }
        const { removed, notFound, next } = removeMatches(entry.categories, args.categories);
        if (removed.length > 0 && next.length === 0) {
          await scoped.saveSeasonsState(omitSeasonCategories(seasonsState, target));
          return textResult({
            target,
            removed,
            notFound,
            total: 0,
            cleared: { [target]: true as const },
          });
        }
        if (removed.length > 0) {
          await scoped.saveSeasonsState(replaceSeasonCategories(seasonsState, target, next));
        }
        return textResult({ target, removed, notFound, total: next.length });
      }

      const currentSeason = findCurrentSeason(seasonsState, Date.now());

      const result: {
        removed: { default?: string[]; current?: string[] };
        notFound: { default?: string[]; current?: string[] };
        totals: { default: number; current: number | null };
        cleared?: { current?: true };
      } = {
        removed: {},
        notFound: {},
        totals: { default: 0, current: currentSeason?.categories?.length ?? null },
      };

      let nextBaseline: string[] | null = null;
      if (target === "default" || target === "both") {
        const baseline = await data.loadCategories();
        const { removed, notFound, next } = removeMatches(baseline, args.categories);
        if (removed.length > 0 && next.length === 0) {
          return errorResult(
            "Refusing to remove: the global categories.json is the cascade floor and cannot be emptied.",
          );
        }
        result.removed.default = removed;
        result.notFound.default = notFound;
        result.totals.default = next.length;
        nextBaseline = removed.length > 0 ? next : null;
      } else {
        result.totals.default = (await data.loadCategories()).length;
      }

      let nextState: SeasonsState | null = null;
      if (target === "current" || target === "both") {
        if (currentSeason === null) {
          return textResult({
            ...result,
            warning:
              "No current season in this game (gap or seasons disabled) — current-targeted removal was a no-op.",
          });
        }
        if (currentSeason.categories === undefined) {
          result.removed.current = [];
          result.notFound.current = args.categories;
          result.totals.current = null;
        } else {
          const { removed, notFound, next } = removeMatches(
            currentSeason.categories,
            args.categories,
          );
          result.removed.current = removed;
          result.notFound.current = notFound;
          if (removed.length > 0 && next.length === 0) {
            nextState = omitSeasonCategories(seasonsState, currentSeason.slug);
            result.totals.current = 0;
            result.cleared = { current: true };
          } else {
            result.totals.current = next.length;
            if (removed.length > 0) {
              nextState = replaceSeasonCategories(seasonsState, currentSeason.slug, next);
            }
          }
        }
      }

      if (nextBaseline !== null) await data.saveCategories(nextBaseline);
      if (nextState !== null) await scoped.saveSeasonsState(nextState);

      return textResult(result);
    },
  );
}
