import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../tools/helpers.js";
import { findCurrentSeason, findSeasonBySlug } from "./data.js";
import type { TriviaDataLayer, SeasonsState } from "./types.js";

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

export function createRemoveCategoriesTool(data: TriviaDataLayer) {
  return tool(
    "remove_categories",
    'Remove categories from the trivia category pool. When seasons are enabled, `target` accepts "current" (the currently-active season), "default" (categories.json baseline), "both" (both), or any specific season slug. The currently-active season\'s pool cannot be emptied. Specific-slug removals cannot empty that season\'s pool either.',
    {
      categories: z.array(z.string()).describe("Categories to remove from the pool"),
      target: z
        .string()
        .optional()
        .describe(
          'Where to remove from. "current" (default): the currently-active season. "default": categories.json. "both": current + default. Any other string: that season slug. Ignored when seasons are disabled.',
        ),
    },
    async (args) => {
      const seasonsState = await data.loadSeasonsState();

      if (seasonsState === null) {
        // Seasons disabled — legacy single-pool behavior. Guard against emptying the pool.
        const existing = await data.loadCategories();
        const { removed, notFound, next } = removeMatches(existing, args.categories);
        if (removed.length > 0 && next.length === 0) {
          return errorResult(
            "Refusing to remove: the active category pool would become empty. Add at least one category first.",
          );
        }
        if (removed.length > 0) await data.saveCategories(next);
        return textResult({ removed, notFound, total: next.length });
      }

      const target = args.target ?? "both";

      // Specific slug target (anything not a special keyword)
      if (target !== "current" && target !== "default" && target !== "both") {
        const entry = findSeasonBySlug(seasonsState, target);
        if (entry === null) {
          return errorResult(`No season with slug "${target}" on the timeline.`);
        }
        const { removed, notFound, next } = removeMatches(entry.categories, args.categories);
        if (removed.length > 0 && next.length === 0) {
          return errorResult(
            `Refusing to remove: season "${target}" would have zero categories — every season must keep at least one.`,
          );
        }
        if (removed.length > 0) {
          await data.saveSeasonsState(replaceSeasonCategories(seasonsState, target, next));
        }
        return textResult({ target, removed, notFound, total: next.length });
      }

      // "current" / "default" / "both" — multi-target dispatch.
      const currentSeason = findCurrentSeason(seasonsState, Date.now());

      const result: {
        removed: { default?: string[]; current?: string[] };
        notFound: { default?: string[]; current?: string[] };
        totals: { default: number; current: number | null };
      } = {
        removed: {},
        notFound: {},
        totals: { default: 0, current: currentSeason?.categories.length ?? null },
      };

      let nextBaseline: string[] | null = null;
      if (target === "default" || target === "both") {
        const baseline = await data.loadCategories();
        const { removed, notFound, next } = removeMatches(baseline, args.categories);
        result.removed.default = removed;
        result.notFound.default = notFound;
        result.totals.default = next.length;
        nextBaseline = removed.length > 0 ? next : null;
      } else {
        result.totals.default = (await data.loadCategories()).length;
      }

      let nextCurrent: string[] | null = null;
      let nextState: SeasonsState | null = null;
      if (target === "current" || target === "both") {
        if (currentSeason === null) {
          return textResult({
            ...result,
            warning:
              "No current season (gap or seasons disabled) — current-targeted removal was a no-op.",
          });
        }
        const { removed, notFound, next } = removeMatches(
          currentSeason.categories,
          args.categories,
        );
        if (removed.length > 0 && next.length === 0) {
          return errorResult(
            "Refusing to remove: the currently-active season's pool would become empty.",
          );
        }
        result.removed.current = removed;
        result.notFound.current = notFound;
        result.totals.current = next.length;
        if (removed.length > 0) {
          nextCurrent = next;
          nextState = replaceSeasonCategories(seasonsState, currentSeason.slug, next);
        }
      }

      if (nextBaseline !== null) await data.saveCategories(nextBaseline);
      if (nextState !== null && nextCurrent !== null) await data.saveSeasonsState(nextState);

      return textResult(result);
    },
  );
}
