import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../../../tools/helpers.js";
import { getAnswerTypeHandler } from "../../answerTypes/registry.js";
import { findCurrentSeason } from "../../core/seasonTimeline.js";
import { rollContextPriority } from "../../domain/contexts.js";
import { resolveEffectiveFormat } from "../../domain/format.js";
import { effectiveHintMode } from "../../domain/hint.js";
import {
  resolveActiveCategories,
  resolveActiveCategoriesWithSource,
} from "../../domain/categories.js";
import { resolveTheme } from "../../domain/theme.js";
import { resolveCascade } from "../../domain/resolveCascade.js";
import { buildCascadeContext } from "../../domain/cascadeContext.js";
import { weightedPick } from "../../domain/weightedPick.js";
import {
  defaultGetGames,
  defaultGetTriviaConfig,
  type GetGamesFn,
  type GetTriviaConfigFn,
} from "../../core/configBridge.js";
import { requireGame } from "../../core/gamesRegistry.js";
import type {
  TriviaDataLayer,
  TriviaAnswersFormat,
  TriviaQuestionType,
  TriviaPromptMedium,
} from "../../core/types.js";
import type { TriviaGame } from "../../core/configTypes.js";

type SuggestedDifficulty = "Easy" | "Medium" | "Hard";

const BUCKET_TO_LABEL: Record<"easy" | "medium" | "hard", SuggestedDifficulty> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
};

const DESCRIPTION = `Get 5 random trivia category suggestions (excluding recently used categories), plus server-rolled metadata the question-flow prompt must honor.

Always returns:
- \`format\`: \`{ slotCount, slots: [{ index, label?, categories }] }\` when the active season defines a \`format\` (multi-slot composition), else \`null\`. \`slots[i].categories\` is the slot's RESOLVED pool (slot.categories ?? season.categories).
- \`slot\` (number): echoes the request's \`slot\` argument (default 0).
- \`categories.ideas\`: 5 random categories drawn from the active source pool (slot's resolved pool when format is present, season's categories otherwise)
- \`suggestedAnswersFormat\`: \`"boolean"\`, \`"choice"\`, or \`"freeform"\` — picked from active answersFormat weights (slot.answersFormat → season.answersFormat → config.trivia.answersFormat → boolean default). \`"freeform"\` means the user types their answer into a Slack modal; Claude writes the canonical answer and a small fast model judges submissions at reveal.
- \`suggestedQuestionType\`: \`"fact"\`, \`"topical"\`, or \`"prediction"\` — picked INDEPENDENTLY from active questionType weights (slot.questionType → season.questionType → config.trivia.questionType → fact default; prediction defaults to weight 0). \`"topical"\` REQUIRES \`WebSearch\` for a RECENT event + a \`sourceUrl\`. \`"prediction"\` REQUIRES \`WebSearch\` for an UPCOMING event + a \`sourceUrl\`, and is SAVED WITHOUT an answer key (settled later at reveal via \`settle_question\`).
- \`suggestedPromptMedium\`: \`"text"\` or \`"image"\` — picked INDEPENDENTLY from active promptMedium weights (slot → season → game → workspace → \`{ text: 1, image: 0 }\` default). \`"image"\` REQUIRES Claude to follow the VISUAL RESEARCH SUBFLOW: pick an available image-search MCP tool (identified by its description, not its name) fitting the rolled category, call it, inspect the inline image, and save \`promptMedium: "image"\` + a \`media\` object. When NO image-search tool is available (or no usable image is found within the retry budget), fall back to the text-medium path for the same \`answersFormat × questionType\`. \`categories.ideas\` is drawn from the same pool regardless of medium.
- \`suggestedDifficulty\`: \`"Easy" | "Medium" | "Hard"\` — picked by weighted-random from the active \`difficultyRatio\` weights for this game type (slot → season → game → workspace → built-in default \`{ easy: 3, medium: 6, hard: 1 }\` for boolean/choice, \`{ easy: 5, medium: 4, hard: 1 }\` for freeform).
- \`suggestedDifficultyRange\`: \`[min, max]\` — the inclusive 1–10 STRICT accept range for the picked bucket on this game type (resolved through slot → season → config → built-in default; freeform is softer than boolean/choice by default). The self-rating in the DIFFICULTY GATE step MUST land inside this range; ratings ±1 off trigger a one-shot reframe; ≥2 off trigger an immediate re-roll.
- \`firstFireOfSeason\` (boolean): \`true\` iff seasons are enabled, a current season exists, AND zero saved questions in this game carry \`season === currentSlug\`. Honor this in the question-posting prompt by prepending a ceremonial opener (\`header\` + \`section\` blocks) ABOVE the question content on the first fire of every new season.
- \`theme\` (optional string): resolved from the cascade \`season.theme → game.theme\`. Mirrored verbatim when set. Mention it in the opener section ONLY when present; never fabricate one or enumerate categories as a substitute.
- \`instructions\` (optional string): resolved from the REPLACE cascade \`slot → season → game → workspace\` of the free-form \`instructions\` axis. Highest-precedence non-empty tier wins. Honor this string verbatim as guidance throughout the question-writing run. Absent → ignore (no fabrication).
- \`additionalInstructions\` (optional string): resolved from the CUMULATIVE cascade of the \`additionalInstructions\` axis — every non-empty tier is concatenated in \`workspace → game → season → slot\` order, each segment tier-labeled (\`[Workspace]\` / \`[Game]\` / \`[Season]\` / \`[Slot N]\`). Honor every labeled rule verbatim throughout the run. Absent → ignore.
- \`contextPriority\` (optional): freshly-rolled weighted-random ordering of every configured lens. Present only when \`trivia.contexts\` is configured at any cascade tier. Claude tries \`contextPriority[0]\` first; descends the list only when the current lens yields no usable question.
- \`suggestedHintMode\`: \`"none" | "button" | "inline"\` — resolved from the cascade \`slot.hint → season.hint → game.hint → workspace.hint → { mode: "none" }\` (whole-object replace per tier). When the resolved \`hint.minDifficulty\` is set and the rolled \`suggestedDifficulty\` bucket falls below it, the effective mode is forced to \`"none"\`. When \`"button"\` or \`"inline"\`, write a hint and pass it to \`save_question\` (see \`hintGuidance\`); when \`"none"\`, do NOT include the \`hint\` field on \`save_question\`.
- \`hintGuidance\` (optional string): present only when \`suggestedHintMode !== "none"\`. Carries the hint-drafting + self-review instructions Claude must honor when writing the hint.

When suggestedAnswersFormat is \`"boolean"\`, also returns:
- \`suggestedAnswer\` (boolean): the truth value the statement MUST have

When suggestedAnswersFormat is \`"choice"\`, also returns:
- \`suggestedChoiceCount\` (integer in active [min, max]): the number of options
- \`suggestedCorrectIndex\` (integer in [0, suggestedChoiceCount)): the 0-based index of the correct option

When suggestedAnswersFormat is \`"freeform"\`, also returns:
- \`suggestedFreeformAnswerShape\`: one of \`"name" | "place" | "phrase" | "title" | "date" | "countable" | "other"\` — picked from active freeformAnswerShape weights (slot.freeformAnswerShape → season.freeformAnswerShape → config.trivia.freeformAnswerShape → uniform default). The question MUST be answered by a value of that shape; this exists to break Claude's strong default bias toward numeric answers. \`"other"\` is a wildcard where Claude reaches for an unconventional answer shape.

Each call rolls suggestions independently — no caching across slot indices. When the active season has a \`format\`, loop slots 0..slotCount-1 with separate calls; do NOT pre-roll all slots up front.

The format / type / answer / index / context rolls are server-side to prevent Claude from biasing them.

When an admin asks "what's configured for trivia?" or wants to audit weights without waiting for a roll, prefer \`list_seasons\` (for season-tier and slot-tier values) and \`list_games\` (for workspace-tier values + cron schedules). Those tools surface raw per-tier configuration; this tool only emits the resolved single-value rolls used for question generation.`;

export function createGetIdeasTool(
  data: TriviaDataLayer,
  getConfigFn: GetTriviaConfigFn = defaultGetTriviaConfig,
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
      let gameEntry: TriviaGame;
      try {
        gameEntry = requireGame(getGamesFn(), args.game);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }

      const scoped = data.forGame(args.game);
      const config = getConfigFn();
      const now = Date.now();
      const slotArg = args.slot ?? 0;

      const seasonsState = await scoped.loadSeasonsState();
      const currentSeasonEntry = findCurrentSeason(seasonsState, now);

      const effectiveFormat = resolveEffectiveFormat(currentSeasonEntry, gameEntry);
      if (effectiveFormat !== null) {
        if (slotArg < 0 || slotArg >= effectiveFormat.questions.length) {
          const tier =
            currentSeasonEntry?.format !== undefined
              ? `active season "${currentSeasonEntry.slug}"`
              : `game "${gameEntry.name}"`;
          return errorResult(
            `slot index ${slotArg} out of range — ${tier} has ${effectiveFormat.questions.length} slot(s).`,
          );
        }
      } else if (slotArg !== 0) {
        return errorResult(
          "no active format — slot argument must be 0 (or omitted) for the single-question flow.",
        );
      }

      const globalCategories = await data.loadCategories();
      const slotIndexForResolution = effectiveFormat !== null ? slotArg : null;
      const { pool: slotCategories, source: categoriesSource } = resolveActiveCategoriesWithSource(
        effectiveFormat,
        slotIndexForResolution,
        currentSeasonEntry,
        gameEntry,
        globalCategories,
      );

      const allQuestions = await scoped.loadQuestions();
      const questions =
        currentSeasonEntry !== null
          ? allQuestions.filter((q) => q.season === currentSeasonEntry.slug)
          : allQuestions;

      const firstFireOfSeason = currentSeasonEntry !== null && questions.length === 0;
      const theme = resolveTheme(currentSeasonEntry, gameEntry) ?? undefined;

      const cascadeCtx = buildCascadeContext(
        currentSeasonEntry,
        gameEntry,
        slotIndexForResolution,
        config,
      );

      const instructions = resolveCascade("instructions", cascadeCtx).value ?? undefined;
      const additionalInstructions =
        resolveCascade("additionalInstructions", cascadeCtx).value ?? undefined;

      const exclusionWindow = Math.min(10, Math.floor(slotCategories.length / 3));
      const recentCategories = new Set(
        questions.slice(-exclusionWindow).map((q) => q.category.toLowerCase()),
      );

      const available = slotCategories.filter(
        (c: string) => !recentCategories.has(c.toLowerCase()),
      );

      const pool = [...available];
      const ideas: string[] = [];
      const count = Math.min(5, pool.length);
      for (let i = 0; i < count; i++) {
        const idx = Math.floor(Math.random() * pool.length);
        ideas.push(pool[idx]);
        pool.splice(idx, 1);
      }

      const formatMeta =
        effectiveFormat !== null
          ? {
              slotCount: effectiveFormat.questions.length,
              slots: effectiveFormat.questions.map((q, i) => ({
                index: i,
                ...(q.label !== undefined ? { label: q.label } : {}),
                categories: resolveActiveCategories(
                  effectiveFormat,
                  i,
                  currentSeasonEntry,
                  gameEntry,
                  globalCategories,
                ),
              })),
            }
          : null;

      const answersFormatWeights = resolveCascade("answersFormat", cascadeCtx).value;
      const pickedAnswersFormat: TriviaAnswersFormat =
        weightedPick(answersFormatWeights) ?? "boolean";

      const questionTypeWeights = resolveCascade("questionType", cascadeCtx).value;
      const pickedQuestionType: TriviaQuestionType = weightedPick(questionTypeWeights) ?? "fact";

      const promptMediumWeights = resolveCascade("promptMedium", cascadeCtx).value;
      const pickedPromptMedium: TriviaPromptMedium = weightedPick(promptMediumWeights) ?? "text";

      const contexts = resolveCascade("contexts", cascadeCtx).value;
      const contextPriority = contexts !== null ? rollContextPriority(contexts) : null;

      const ratioWeights = resolveCascade("difficultyRatio", cascadeCtx, {
        answersFormat: pickedAnswersFormat,
      }).value;
      const pickedBucket = weightedPick(ratioWeights) ?? "medium";
      const suggestedDifficulty: SuggestedDifficulty = BUCKET_TO_LABEL[pickedBucket];

      const difficultyRanges = resolveCascade("difficulty", cascadeCtx, {
        answersFormat: pickedAnswersFormat,
      }).value;
      const suggestedDifficultyRange = difficultyRanges[pickedBucket];

      const resolvedHint = resolveCascade("hint", cascadeCtx).value;
      const suggestedHintMode = effectiveHintMode(resolvedHint, pickedBucket);
      const hintGuidance =
        suggestedHintMode !== "none"
          ? "Write ONE concise hint (≤140 chars) that nudges toward the answer WITHOUT stating or paraphrasing it. After drafting, self-review: if the draft reveals the answer outright or restates it in different words, rewrite as a softer semantic-neighborhood nudge. Pass the final text to save_question as `hint: { mode: suggestedHintMode, text }`. If no useful nudge exists for this question, OMIT the hint field on save_question rather than ship a weak one."
          : undefined;

      const base = {
        format: formatMeta,
        slot: slotArg,
        categories: {
          ideas,
          total: slotCategories.length,
          excluded: recentCategories.size,
          source: categoriesSource,
        },
        suggestedAnswersFormat: pickedAnswersFormat,
        suggestedQuestionType: pickedQuestionType,
        suggestedPromptMedium: pickedPromptMedium,
        suggestedDifficulty,
        suggestedDifficultyRange,
        suggestedHintMode,
        firstFireOfSeason,
        ...(theme !== undefined ? { theme } : {}),
        ...(instructions !== undefined ? { instructions } : {}),
        ...(additionalInstructions !== undefined ? { additionalInstructions } : {}),
        ...(contextPriority !== null ? { contextPriority } : {}),
        ...(hintGuidance !== undefined ? { hintGuidance } : {}),
      };

      // Per-format suggestion rolling lives in the handler: boolean returns
      // { suggestedAnswer }; choice returns { suggestedChoiceCount, suggestedCorrectIndex };
      // freeform returns { suggestedFreeformAnswerShape } resolved via resolveCascade. The
      // handler receives the cascade context so it resolves cascade members canonically.
      const handler = getAnswerTypeHandler(pickedAnswersFormat);
      const perFormat = handler.rollGenerationSuggestions({ cascadeCtx });

      return textResult({ ...base, ...perFormat });
    },
  );
}
