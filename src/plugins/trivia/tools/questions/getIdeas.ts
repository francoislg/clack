import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../../../tools/helpers.js";
import { getConfig, type Config } from "../../../../config.js";
import { findCurrentSeason } from "../../core/seasonTimeline.js";
import { getActiveChoiceBounds, resolveAnswersFormat } from "../../domain/questionTypes.js";
import { resolveQuestionType } from "../../domain/factTopical.js";
import { resolveAnswerShape } from "../../domain/answerShape.js";
import { resolveContexts, rollContextPriority } from "../../domain/contexts.js";
import { resolveDifficultyRanges } from "../../domain/difficulty.js";
import { resolveSlotCategories } from "../../domain/seasonFormat.js";
import { weightedPick } from "../../domain/weightedPick.js";
import { defaultGetGames, type GetGamesFn } from "../../core/configBridge.js";
import { requireGame } from "../../core/gamesRegistry.js";
import type { TriviaDataLayer, TriviaAnswersFormat, TriviaQuestionType } from "../../core/types.js";
import type { TriviaAnswerShape } from "../../../../config.js";

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
- \`format\`: \`{ slotCount, slots: [{ index, label?, categories }] }\` when the active season defines a \`format\` (multi-slot composition), else \`null\`. \`slots[i].categories\` is the slot's RESOLVED pool (slot.categories ?? season.categories).
- \`slot\` (number): echoes the request's \`slot\` argument (default 0).
- \`categories.ideas\`: 5 random categories drawn from the active source pool (slot's resolved pool when format is present, season's categories otherwise)
- \`suggestedAnswersFormat\`: \`"boolean"\`, \`"choice"\`, or \`"freeform"\` — picked from active answersFormat weights (slot.answersFormat → season.answersFormat → config.trivia.answersFormat → boolean default). \`"freeform"\` means the user types their answer into a Slack modal; Claude writes the canonical answer and a small fast model judges submissions at reveal.
- \`suggestedQuestionType\`: \`"fact"\` or \`"topical"\` — picked INDEPENDENTLY from active questionType weights (slot.questionType → season.questionType → config.trivia.questionType → fact default). \`"topical"\` REQUIRES Claude to use \`WebSearch\` and capture a \`sourceUrl\` when saving.
- \`suggestedDifficulty\`: \`"Easy" | "Medium" | "Hard"\`
- \`suggestedDifficultyRange\`: \`[min, max]\` — the inclusive 1–10 target range for the picked bucket on this game type (resolved through slot → season → config → built-in default; freeform is softer than boolean/choice by default). The self-rating in the DIFFICULTY GATE step MUST aim inside this range.
- \`minimumDifficultyThreshold\` (integer in [1, 10]): self-ratings strictly below this value MUST be REJECTED at the DIFFICULTY GATE. Resolves through the same cascade — defaults to 4 for boolean/choice, 2 for freeform.
- \`firstFireOfSeason\` (boolean): \`true\` iff seasons are enabled, a current season exists, AND zero saved questions in this game carry \`season === currentSlug\`. Honor this in the question-posting prompt by prepending a ceremonial opener (\`header\` + \`section\` blocks) ABOVE the question content on the first fire of every new season.
- \`theme\` (optional string): mirrored verbatim from the current season's \`theme\` when set. Mention it in the opener section ONLY when present; never fabricate one or enumerate categories as a substitute.
- \`contextPriority\` (optional): freshly-rolled weighted-random ordering of every configured lens. Present only when \`trivia.contexts\` is configured at any cascade tier. Claude tries \`contextPriority[0]\` first; descends the list only when the current lens yields no usable question.

When suggestedAnswersFormat is \`"boolean"\`, also returns:
- \`suggestedAnswer\` (boolean): the truth value the statement MUST have

When suggestedAnswersFormat is \`"choice"\`, also returns:
- \`suggestedChoiceCount\` (integer in active [min, max]): the number of options
- \`suggestedCorrectIndex\` (integer in [0, suggestedChoiceCount)): the 0-based index of the correct option

When suggestedAnswersFormat is \`"freeform"\`, also returns:
- \`suggestedAnswerShape\`: one of \`"name" | "place" | "phrase" | "title" | "date" | "number" | "other"\` — picked from active answerShape weights (slot.answerShape → season.answerShape → config.trivia.answerShape → uniform default). The question MUST be answered by a value of that shape; this exists to break Claude's strong default bias toward numeric answers. \`"other"\` is a wildcard where Claude reaches for an unconventional answer shape.

Each call rolls suggestions independently — no caching across slot indices. When the active season has a \`format\`, loop slots 0..slotCount-1 with separate calls; do NOT pre-roll all slots up front.

The format / type / answer / index / context rolls are server-side to prevent Claude from biasing them.`;

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
      slot: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe(
          "Slot index within the active season's format. Default 0. When the active season has no format, only 0 is permitted. When format is present, must be in [0, slotCount).",
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
      const slotArg = args.slot ?? 0;

      const seasonsState = await scoped.loadSeasonsState();
      const currentSeasonEntry = findCurrentSeason(seasonsState, now);

      const seasonFormat = currentSeasonEntry?.format;
      if (seasonFormat !== undefined) {
        if (slotArg < 0 || slotArg >= seasonFormat.questions.length) {
          return errorResult(
            `slot index ${slotArg} out of range — active season "${currentSeasonEntry?.slug}" has ${seasonFormat.questions.length} slot(s).`,
          );
        }
      } else if (slotArg !== 0) {
        return errorResult(
          "season has no format — slot argument must be 0 (or omitted) for the single-question flow.",
        );
      }

      const seasonCategories =
        currentSeasonEntry !== null ? currentSeasonEntry.categories : await data.loadCategories();
      const slotCategories =
        seasonFormat !== undefined
          ? resolveSlotCategories(seasonFormat.questions[slotArg], seasonCategories)
          : seasonCategories;

      const allQuestions = await scoped.loadQuestions();
      const questions =
        currentSeasonEntry !== null
          ? allQuestions.filter((q) => q.season === currentSeasonEntry.slug)
          : allQuestions;

      const firstFireOfSeason = currentSeasonEntry !== null && questions.length === 0;
      const theme =
        currentSeasonEntry !== null &&
        typeof currentSeasonEntry.theme === "string" &&
        currentSeasonEntry.theme.length > 0
          ? currentSeasonEntry.theme
          : undefined;

      const exclusionWindow = Math.min(10, Math.floor(slotCategories.length / 3));
      const recentCategories = new Set(
        questions.slice(-exclusionWindow).map((q) => q.category.toLowerCase()),
      );

      const available = slotCategories.filter((c) => !recentCategories.has(c.toLowerCase()));

      const pool = [...available];
      const ideas: string[] = [];
      const count = Math.min(5, pool.length);
      for (let i = 0; i < count; i++) {
        const idx = Math.floor(Math.random() * pool.length);
        ideas.push(pool[idx]);
        pool.splice(idx, 1);
      }

      const formatMeta =
        seasonFormat !== undefined
          ? {
              slotCount: seasonFormat.questions.length,
              slots: seasonFormat.questions.map((q, i) => ({
                index: i,
                ...(q.label !== undefined ? { label: q.label } : {}),
                categories: resolveSlotCategories(q, seasonCategories),
              })),
            }
          : null;

      const slotIndexForResolution = seasonFormat !== undefined ? slotArg : null;

      const answersFormatWeights = resolveAnswersFormat(
        currentSeasonEntry,
        slotIndexForResolution,
        config,
      );
      const pickedAnswersFormat: TriviaAnswersFormat =
        weightedPick(answersFormatWeights) ?? "boolean";

      const questionTypeWeights = resolveQuestionType(
        currentSeasonEntry,
        slotIndexForResolution,
        config,
      );
      const pickedQuestionType: TriviaQuestionType = weightedPick(questionTypeWeights) ?? "fact";

      const contexts = resolveContexts(currentSeasonEntry, slotIndexForResolution, config);
      const contextPriority = contexts !== null ? rollContextPriority(contexts) : null;

      const suggestedDifficulty = pickSuggestedDifficulty();

      const difficultyRanges = resolveDifficultyRanges(
        currentSeasonEntry,
        slotIndexForResolution,
        config,
        pickedAnswersFormat,
      );
      const bucketKey =
        suggestedDifficulty === "Easy"
          ? "easy"
          : suggestedDifficulty === "Medium"
            ? "medium"
            : "hard";
      const suggestedDifficultyRange = difficultyRanges[bucketKey];
      const minimumDifficultyThreshold = difficultyRanges.minimumThreshold;

      const base = {
        format: formatMeta,
        slot: slotArg,
        categories: {
          ideas,
          total: slotCategories.length,
          excluded: recentCategories.size,
        },
        suggestedAnswersFormat: pickedAnswersFormat,
        suggestedQuestionType: pickedQuestionType,
        suggestedDifficulty,
        suggestedDifficultyRange,
        minimumDifficultyThreshold,
        firstFireOfSeason,
        ...(theme !== undefined ? { theme } : {}),
        ...(contextPriority !== null ? { contextPriority } : {}),
      };

      if (pickedAnswersFormat === "choice") {
        const bounds = config !== null ? getActiveChoiceBounds(config) : { min: 4, max: 4 };
        const suggestedChoiceCount = randomIntInclusive(bounds.min, bounds.max);
        const suggestedCorrectIndex = randomIntInclusive(0, suggestedChoiceCount - 1);
        return textResult({
          ...base,
          suggestedChoiceCount,
          suggestedCorrectIndex,
        });
      }

      if (pickedAnswersFormat === "freeform") {
        const answerShapeWeights = resolveAnswerShape(
          currentSeasonEntry,
          slotIndexForResolution,
          config,
        );
        const pickedAnswerShape: TriviaAnswerShape = weightedPick(answerShapeWeights) ?? "name";
        return textResult({ ...base, suggestedAnswerShape: pickedAnswerShape });
      }

      return textResult({
        ...base,
        suggestedAnswer: Math.random() < 0.5,
      });
    },
  );
}
