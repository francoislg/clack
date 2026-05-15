import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult } from "../../tools/helpers.js";
import { findCurrentSeason, findSeasonBySlug } from "./data.js";
import type { TriviaDataLayer, SeasonsState } from "./types.js";

function appendUnique(
  list: string[],
  toAdd: string[],
): { added: string[]; alreadyExists: string[] } {
  const lower = list.map((c) => c.toLowerCase());
  const added: string[] = [];
  const alreadyExists: string[] = [];
  for (const category of toAdd) {
    const categoryLower = category.toLowerCase();
    if (lower.includes(categoryLower)) {
      alreadyExists.push(category);
    } else {
      added.push(category);
      list.push(category);
      lower.push(categoryLower);
    }
  }
  return { added, alreadyExists };
}

function replaceSeasonCategories(state: SeasonsState, slug: string, next: string[]): SeasonsState {
  return {
    seasons: state.seasons.map((s) => (s.slug === slug ? { ...s, categories: next } : s)),
  };
}

export function createAddCategoriesTool(data: TriviaDataLayer) {
  return tool(
    "add_categories",
    'Add new categories to the trivia category pool. When seasons are enabled, `target` accepts "current" (the currently-active season), "default" (the categories.json baseline that new seasons seed from), "both" (the default — use now and persist), or any specific season slug to refine a queued future season\'s pool.',
    {
      categories: z.array(z.string()).describe("Categories to add to the pool"),
      target: z
        .string()
        .optional()
        .describe(
          'Where to add. "current": the currently-active season. "default": categories.json. "both" (default when seasons enabled): both. Any other string: that season slug. Ignored when seasons are disabled.',
        ),
    },
    async (args) => {
      const seasonsState = await data.loadSeasonsState();

      if (seasonsState === null) {
        // Seasons disabled — legacy single-pool behavior.
        const existing = await data.loadCategories();
        const { added, alreadyExists } = appendUnique(existing, args.categories);
        if (added.length > 0) await data.saveCategories(existing);
        return textResult({ added, alreadyExists, total: existing.length });
      }

      const target = args.target ?? "both";

      // Specific slug target (anything not a special keyword)
      if (target !== "current" && target !== "default" && target !== "both") {
        const entry = findSeasonBySlug(seasonsState, target);
        if (entry === null) {
          return textResult({
            added: [],
            alreadyExists: [],
            error: `No season with slug "${target}" on the timeline.`,
          });
        }
        const next = [...entry.categories];
        const { added, alreadyExists } = appendUnique(next, args.categories);
        if (added.length > 0) {
          await data.saveSeasonsState(replaceSeasonCategories(seasonsState, target, next));
        }
        return textResult({ target, added, alreadyExists, total: next.length });
      }

      // "current" / "default" / "both" — multi-target dispatch.
      const currentSeason = findCurrentSeason(seasonsState, Date.now());

      const result: {
        added: { default?: string[]; current?: string[] };
        alreadyExists: { default?: string[]; current?: string[] };
        totals: { default: number; current: number | null };
        warning?: string;
      } = {
        added: {},
        alreadyExists: {},
        totals: { default: 0, current: currentSeason?.categories.length ?? null },
      };

      if (target === "default" || target === "both") {
        const baseline = await data.loadCategories();
        const { added, alreadyExists } = appendUnique(baseline, args.categories);
        if (added.length > 0) await data.saveCategories(baseline);
        result.added.default = added;
        result.alreadyExists.default = alreadyExists;
        result.totals.default = baseline.length;
      } else {
        result.totals.default = (await data.loadCategories()).length;
      }

      if (target === "current" || target === "both") {
        if (currentSeason === null) {
          result.warning =
            "No current season (gap or seasons disabled) — current-targeted add was a no-op.";
        } else {
          const next = [...currentSeason.categories];
          const { added, alreadyExists } = appendUnique(next, args.categories);
          if (added.length > 0) {
            await data.saveSeasonsState(
              replaceSeasonCategories(seasonsState, currentSeason.slug, next),
            );
          }
          result.added.current = added;
          result.alreadyExists.current = alreadyExists;
          result.totals.current = next.length;
        }
      }

      return textResult(result);
    },
  );
}
