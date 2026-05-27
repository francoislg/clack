import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../../../tools/helpers.js";
import { defaultGetGames, type GetGamesFn } from "../../core/configBridge.js";
import { requireGame } from "../../core/gamesRegistry.js";
import type { TriviaDataLayer, SeasonEntry } from "../../core/types.js";
import type {
  SeasonFormatSlot,
  TriviaAnswersFormatWeights,
  TriviaQuestionTypeWeights,
  TriviaFreeformAnswerShapeWeights,
  TriviaContextEntry,
  TriviaDifficultyConfig,
  TriviaDifficultyRatioConfig,
} from "../../core/configTypes.js";

type Status = "past" | "current" | "future";

interface ListSeasonsSlotEntry {
  label?: string;
  categories?: string[];
  answersFormat?: TriviaAnswersFormatWeights;
  questionType?: TriviaQuestionTypeWeights;
  freeformAnswerShape?: TriviaFreeformAnswerShapeWeights;
  contexts?: TriviaContextEntry[];
  difficulty?: TriviaDifficultyConfig;
  difficultyRatio?: TriviaDifficultyRatioConfig;
  liveAnswersVisible?: boolean;
  revealResponses?: "no" | "just-correctness" | "yes";
  instructions?: string;
  additionalInstructions?: string;
}

function statusOf(entry: SeasonEntry, now: number): Status {
  if (entry.startedAt > now) return "future";
  const effectiveEnd = entry.endedAt ?? entry.expectedEndAt;
  if (effectiveEnd <= now) return "past";
  return "current";
}

function mapSlot(slot: SeasonFormatSlot): ListSeasonsSlotEntry {
  return {
    ...(slot.label !== undefined ? { label: slot.label } : {}),
    ...(slot.categories !== undefined ? { categories: slot.categories } : {}),
    ...(slot.answersFormat !== undefined ? { answersFormat: slot.answersFormat } : {}),
    ...(slot.questionType !== undefined ? { questionType: slot.questionType } : {}),
    ...(slot.freeformAnswerShape !== undefined
      ? { freeformAnswerShape: slot.freeformAnswerShape }
      : {}),
    ...(slot.contexts !== undefined ? { contexts: slot.contexts } : {}),
    ...(slot.difficulty !== undefined ? { difficulty: slot.difficulty } : {}),
    ...(slot.difficultyRatio !== undefined ? { difficultyRatio: slot.difficultyRatio } : {}),
    ...(slot.liveAnswersVisible !== undefined
      ? { liveAnswersVisible: slot.liveAnswersVisible }
      : {}),
    ...(slot.revealResponses !== undefined ? { revealResponses: slot.revealResponses } : {}),
    ...(slot.instructions !== undefined ? { instructions: slot.instructions } : {}),
    ...(slot.additionalInstructions !== undefined
      ? { additionalInstructions: slot.additionalInstructions }
      : {}),
  };
}

const DESCRIPTION = `List every season on a specific game's trivia timeline with full details — slug, dates, categories, status flag ("past" | "current" | "future"), and the season's explicitly-set axis configuration (theme, answersFormat, questionType, freeformAnswerShape, contexts, difficulty, difficultyRatio, format).

Each axis field is present on a season entry IF AND ONLY IF the season explicitly set it. Absence means that season falls through to the next tier of the cascade.

The cascade tier order is: \`slot → season → game → workspace → built-in default\`. To audit the game tier (including a game's optional \`format\`, \`categories\`, and \`theme\` overrides) AND the workspace tier, call \`list_games\` — its per-entry fields surface the game tier and its \`workspaceDefaults\` block surfaces the workspace tier. Together the two tools cover every configurable tier.

Use this to inspect what's queued, see a future season's category pool before it goes live, or audit past seasons. Returns the timeline in stored order.`;

export function createListSeasonsTool(
  data: TriviaDataLayer,
  getGamesFn: GetGamesFn = defaultGetGames,
) {
  return tool(
    "list_seasons",
    DESCRIPTION,
    {
      game: z
        .string()
        .describe(
          "Game name (must be present in config.trivia.games[]). The timeline is scoped to this game's seasons.json.",
        ),
    },
    async (args) => {
      try {
        requireGame(getGamesFn(), args.game);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }

      const scoped = data.forGame(args.game);
      const state = await scoped.loadSeasonsState();
      if (state === null) {
        return errorResult(
          `Seasons are not initialized for game "${args.game}" (seasons.json missing). Cannot list.`,
        );
      }
      const now = Date.now();
      const seasons = state.seasons.map((entry) => ({
        slug: entry.slug,
        startedAt: entry.startedAt,
        expectedEndAt: entry.expectedEndAt,
        endedAt: entry.endedAt ?? null,
        categories: entry.categories,
        status: statusOf(entry, now),
        ...(entry.theme !== undefined ? { theme: entry.theme } : {}),
        ...(entry.answersFormat !== undefined ? { answersFormat: entry.answersFormat } : {}),
        ...(entry.questionType !== undefined ? { questionType: entry.questionType } : {}),
        ...(entry.freeformAnswerShape !== undefined
          ? { freeformAnswerShape: entry.freeformAnswerShape }
          : {}),
        ...(entry.contexts !== undefined ? { contexts: entry.contexts } : {}),
        ...(entry.difficulty !== undefined ? { difficulty: entry.difficulty } : {}),
        ...(entry.difficultyRatio !== undefined ? { difficultyRatio: entry.difficultyRatio } : {}),
        ...(entry.format !== undefined
          ? { format: { questions: entry.format.questions.map(mapSlot) } }
          : {}),
        ...(entry.instructions !== undefined ? { instructions: entry.instructions } : {}),
        ...(entry.additionalInstructions !== undefined
          ? { additionalInstructions: entry.additionalInstructions }
          : {}),
      }));
      return textResult({ game: args.game, seasons, total: seasons.length });
    },
  );
}
