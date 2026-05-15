import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult } from "../../tools/helpers.js";
import { getConfig, type Config } from "../../config.js";
import { findCurrentSeason } from "./data.js";
import { getActiveChoiceBounds, getActiveQuestionTypes } from "./questionTypes.js";
import { weightedPick } from "./weightedPick.js";
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

/**
 * `getConfigFn` is injectable so tests can supply a stubbed config without
 * having to call `loadConfig()`. Production callers omit it and we fall through
 * to the shared `getConfig()` singleton — but tolerate the "config not loaded"
 * error and treat it as "no trivia config, use defaults," because the trivia
 * plugin loads before the Slack app starts and tests for adjacent tools (e.g.
 * seasons) wire up `createGetIdeasTool(data)` without booting the full config.
 */
export function createGetIdeasTool(
  data: TriviaDataLayer,
  getConfigFn: () => Config | null = () => {
    try {
      return getConfig();
    } catch {
      return null;
    }
  },
) {
  return tool("get_ideas", DESCRIPTION, {}, async () => {
    const config = getConfigFn();
    const now = Date.now();

    const seasonsState = await data.loadSeasonsState();
    const currentSeasonEntry = findCurrentSeason(seasonsState, now);
    // Source pool: the currently-active season's categories when one exists,
    // otherwise (seasons disabled OR in a timeline gap) the legacy global pool.
    const categories =
      currentSeasonEntry !== null ? currentSeasonEntry.categories : await data.loadCategories();
    const allQuestions = await data.loadQuestions();
    // When a current season exists, "recent" means within the current season —
    // keeps the exclusion signal honest across timeline transitions.
    const questions =
      currentSeasonEntry !== null
        ? allQuestions.filter((q) => q.season === currentSeasonEntry.slug)
        : allQuestions;

    // Scale the exclusion window so small themed pools don't deadlock with an empty ideas array.
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
      config !== null ? await getActiveQuestionTypes(data, config, now) : { boolean: 1, choice: 0 };
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
  });
}
