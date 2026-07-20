import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../../../plugins-sdk/sdk.js";
import { findCurrentSeason, findSeasonBySlug } from "../../core/seasonTimeline.js";
import { defaultGetGames, type GetGamesFn } from "../../core/configBridge.js";
import { requireGame } from "../../core/gamesRegistry.js";
import type { TriviaDataLayer, SeasonsState } from "../../core/types.js";
import type { TriviaGame } from "../../core/configTypes.js";

/**
 * Build the structured "season inherits its categories" error payload. The
 * `add_categories` tool refuses to mutate an inheriting season because doing
 * so would silently materialize the field — admins must break inheritance
 * explicitly via `upsert_season(slug, { categories: [...] })` first.
 */
function inheritsError(slug: string, game: TriviaGame): string {
  const source: "game" | "global" =
    game.categories !== undefined && game.categories.length > 0 ? "game" : "global";
  const payload = {
    code: "SEASON_INHERITS_CATEGORIES" as const,
    slug,
    source,
    message: `Season "${slug}" inherits its categories from the ${source} cascade tier. Call upsert_season(slug: "${slug}", { categories: [...] }) to break inheritance before adding individual entries.`,
  };
  return JSON.stringify(payload);
}

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

export function createAddCategoriesTool(
  data: TriviaDataLayer,
  getGamesFn: GetGamesFn = defaultGetGames,
) {
  return tool(
    "add_categories",
    'Add new categories to the trivia category pool. The `game` argument scopes any season-targeted writes to that game\'s seasons.json; the global categories.json (target "default") is shared. When seasons are enabled, `target` accepts "current" (the named game\'s currently-active season), "default" (the global categories.json baseline), "both" (the default — use now and persist), or any specific season slug within the named game.',
    {
      game: z
        .string()
        .describe(
          "Game name (must be present in config.trivia.games[]). Season-targeted writes apply to this game's seasons.json.",
        ),
      categories: z.array(z.string()).describe("Categories to add to the pool"),
      target: z
        .string()
        .optional()
        .describe(
          'Where to add. "current": this game\'s currently-active season. "default": global categories.json. "both" (default when seasons enabled): both. Any other string: that season slug within this game.',
        ),
    },
    async (args) => {
      let game: TriviaGame;
      try {
        game = requireGame(getGamesFn(), args.game);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }

      const scoped = data.forGame(args.game);
      const seasonsState = await scoped.loadSeasonsState();

      if (seasonsState === null) {
        const existing = await data.loadCategories();
        const { added, alreadyExists } = appendUnique(existing, args.categories);
        if (added.length > 0) await data.saveCategories(existing);
        return textResult({ added, alreadyExists, total: existing.length });
      }

      const target = args.target ?? "both";

      if (target !== "current" && target !== "default" && target !== "both") {
        const entry = findSeasonBySlug(seasonsState, target);
        if (entry === null) {
          return textResult({
            added: [],
            alreadyExists: [],
            error: `No season with slug "${target}" on this game's timeline.`,
          });
        }
        if (entry.categories === undefined) {
          return errorResult(inheritsError(target, game));
        }
        const next = [...entry.categories];
        const { added, alreadyExists } = appendUnique(next, args.categories);
        if (added.length > 0) {
          await scoped.saveSeasonsState(replaceSeasonCategories(seasonsState, target, next));
        }
        return textResult({ target, added, alreadyExists, total: next.length });
      }

      const currentSeason = findCurrentSeason(seasonsState, Date.now());

      const result: {
        added: { default?: string[]; current?: string[] };
        alreadyExists: { default?: string[]; current?: string[] };
        totals: { default: number; current: number | null };
        warning?: string;
      } = {
        added: {},
        alreadyExists: {},
        totals: { default: 0, current: currentSeason?.categories?.length ?? null },
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
            "No current season in this game (gap or seasons disabled) — current-targeted add was a no-op.";
        } else if (currentSeason.categories === undefined) {
          return errorResult(inheritsError(currentSeason.slug, game));
        } else {
          const next = [...currentSeason.categories];
          const { added, alreadyExists } = appendUnique(next, args.categories);
          if (added.length > 0) {
            await scoped.saveSeasonsState(
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
