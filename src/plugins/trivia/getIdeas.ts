import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../tools/helpers.js";
import { getConfig, type Config } from "../../config.js";
import { findCurrentSeason } from "./data.js";
import { getActiveChoiceBounds, getActiveQuestionTypes } from "./questionTypes.js";
import { weightedPick } from "./weightedPick.js";
import { defaultGetGames, type GetGamesFn } from "./configBridge.js";
import { requireGame } from "./gamesRegistry.js";
import type { TriviaDataLayer, TriviaQuestionType } from "./types.js";

type SuggestedDifficulty = "Easy" | "Medium" | "Hard";

function pickSuggestedDifficulty(): SuggestedDifficulty {
  const r = Math.random();
  if (r < 0.3) return "Easy";
  if (r < 0.9) return "Medium";
  return "Hard";
}

/** Inclusive uniform integer in `[min, max]`. */
function randomIntInclusive(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const DESCRIPTION = `Get 5 random trivia category suggestions (excluding recently used categories), plus server-rolled metadata the question-flow prompt must honor.

Always returns:
- \`categories.ideas\`: 5 random categories
- \`suggestedType\`: \`"boolean"\` or \`"choice"\` — picked from active questionsTypes weights
- \`suggestedDifficulty\`: \`"Easy" | "Medium" | "Hard"\`

When suggestedType is \`"boolean"\`, also returns:
- \`suggestedAnswer\` (boolean): the truth value the statement MUST have

When suggestedType is \`"choice"\`, also returns:
- \`suggestedChoiceCount\` (integer in active [min, max]): the number of options
- \`suggestedCorrectIndex\` (integer in [0, suggestedChoiceCount)): the 0-based index of the correct option

The type / answer / index rolls are server-side to prevent Claude from biasing the polarity, choice count, or correct position.`;

export function createGetIdeasTool(
  data: TriviaDataLayer,
  getConfigFn: () => Config | null = () => {
    try {
      return getConfig();
    } catch {
      return null;
    }
  },
  getGamesFn: GetGamesFn = defaultGetGames,
) {
  return tool(
    "get_ideas",
    DESCRIPTION,
    {
      game: z
        .string()
        .describe(
          "Game name (must be present in config.trivia.games[]). Recent-category exclusion is scoped to this game's question history.",
        ),
    },
    async (args) => {
      try {
        requireGame(getGamesFn(), args.game);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }

      const scoped = data.forGame(args.game);
      const config = getConfigFn();
      const now = Date.now();

      const seasonsState = await scoped.loadSeasonsState();
      const currentSeasonEntry = findCurrentSeason(seasonsState, now);
      const categories =
        currentSeasonEntry !== null ? currentSeasonEntry.categories : await data.loadCategories();
      const allQuestions = await scoped.loadQuestions();
      const questions =
        currentSeasonEntry !== null
          ? allQuestions.filter((q) => q.season === currentSeasonEntry.slug)
          : allQuestions;

      const exclusionWindow = Math.min(10, Math.floor(categories.length / 3));
      const recentCategories = new Set(
        questions.slice(-exclusionWindow).map((q) => q.category.toLowerCase()),
      );

      const available = categories.filter((c) => !recentCategories.has(c.toLowerCase()));

      const pool = [...available];
      const ideas: string[] = [];
      const count = Math.min(5, pool.length);
      for (let i = 0; i < count; i++) {
        const idx = Math.floor(Math.random() * pool.length);
        ideas.push(pool[idx]);
        pool.splice(idx, 1);
      }

      const weights =
        config !== null
          ? await getActiveQuestionTypes(scoped, config, now)
          : { boolean: 1, choice: 0 };
      const picked: TriviaQuestionType = weightedPick(weights) ?? "boolean";

      const suggestedDifficulty = pickSuggestedDifficulty();

      const base = {
        categories: {
          ideas,
          total: categories.length,
          excluded: recentCategories.size,
        },
        suggestedType: picked,
        suggestedDifficulty,
      };

      if (picked === "choice") {
        const bounds = config !== null ? getActiveChoiceBounds(config) : { min: 2, max: 4 };
        const suggestedChoiceCount = randomIntInclusive(bounds.min, bounds.max);
        const suggestedCorrectIndex = randomIntInclusive(0, suggestedChoiceCount - 1);
        return textResult({
          ...base,
          suggestedChoiceCount,
          suggestedCorrectIndex,
        });
      }

      return textResult({
        ...base,
        suggestedAnswer: Math.random() < 0.5,
      });
    },
  );
}
