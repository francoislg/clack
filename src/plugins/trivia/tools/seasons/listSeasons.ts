import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../../../plugins-sdk/sdk.js";
import { defaultGetGames, type GetGamesFn } from "../../core/configBridge.js";
import { requireGame } from "../../core/gamesRegistry.js";
import { resolveActiveCategoriesWithSource } from "../../domain/categories.js";
import { buildCascadeContext } from "../../domain/cascadeContext.js";
import { derivePhaseWindows, selectActivePhase } from "../../domain/seasonPhases.js";
import type { TriviaDataLayer, SeasonEntry } from "../../core/types.js";
import type {
  JudgeLeniency,
  SeasonFormatSlot,
  TriviaAnswersFormatWeights,
  TriviaQuestionTypeWeights,
  TriviaFreeformAnswerShapeWeights,
  TriviaContextEntry,
  TriviaDifficultyConfig,
  TriviaDifficultyRatioConfig,
  TriviaGame,
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
  revealResponses?: "no" | "just-winners" | "just-correctness" | "yes";
  instructions?: string;
  additionalInstructions?: string;
  judgeInstructions?: string;
  judgeLeniency?: JudgeLeniency;
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
    ...(slot.judgeInstructions !== undefined ? { judgeInstructions: slot.judgeInstructions } : {}),
    ...(slot.judgeLeniency !== undefined ? { judgeLeniency: slot.judgeLeniency } : {}),
  };
}

interface ListSeasonsPhaseWindow {
  slug: string;
  /** Derived window start (Unix-ms), chained from the season's startedAt. */
  start: number;
  /** Derived window end (Unix-ms), clamped to the season end. */
  end: number;
  /** True for the one slice whose window contains `now` (none when the season isn't live). */
  active: boolean;
}

/**
 * Project a season's declared phases onto their DERIVED timeline: each slice's
 * slug + computed [start, end) window, with the currently-active slice flagged.
 * Never recomputes windows by hand — `derivePhaseWindows` owns the chaining.
 */
function buildPhaseTimeline(entry: SeasonEntry, now: number): ListSeasonsPhaseWindow[] {
  const active = selectActivePhase(entry, now);
  return derivePhaseWindows(entry).map((window) => ({
    slug: window.slice.slug,
    start: window.start,
    end: window.end,
    active: active !== null && active.slug === window.slice.slug,
  }));
}

const DESCRIPTION = `List every season on a specific game's trivia timeline with full details — slug, dates, status flag ("past" | "current" | "future"), and the season's explicitly-set axis configuration (theme, answersFormat, questionType, freeformAnswerShape, contexts, difficulty, difficultyRatio, instructions, additionalInstructions, judgeInstructions, judgeLeniency, format, slotOverrides). \`judgeLeniency\` (season and slot tiers) is one of four presets — \`"strict"\`, \`"strict-with-typos"\`, \`"lenient"\`, \`"evaluate"\` (the only one that accepts a correct answer outside the answer key); \`judgeInstructions\` (season and slot tiers) is the only free text that reaches the freeform reveal judge.

A season that declares \`phases\` (duration-chained rules windows) also carries a \`phases\` array where each entry is the slice's \`slug\` plus its DERIVED \`start\`/\`end\` (Unix-ms, chained from the season's startedAt — never stored on disk) and an \`active\` flag marking the one slice whose window contains now. This is the only surface that shows when a phase actually flips. Seasons with no phases carry no \`phases\` key.

Each axis field (including \`categories\`) is present on a season entry IF AND ONLY IF the season explicitly set it. Absence means that season falls through to the next tier of the cascade. Every entry additionally carries \`resolvedCategoriesCount\` and \`resolvedCategoriesSource\` ("phase" | "season" | "game" | "global") so you can audit inheritance without re-deriving the cascade.

The cascade tier order for axes is: \`seasonSlot → seasonPhase → season → gameSlot → game → workspace → built-in default\`. The category cascade is: \`slot → phase → season → game → categories.json\`. To audit the game tier (including a game's optional \`format\`, \`categories\`, and \`theme\` overrides) AND the workspace tier, call \`list_games\` — its per-entry fields surface the game tier and its \`workspaceDefaults\` block surfaces the workspace tier. Together the two tools cover every configurable tier.

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
      let gameEntry: TriviaGame;
      try {
        gameEntry = requireGame(getGamesFn(), args.game);
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
      const globalCategories = await data.loadCategories();
      const now = Date.now();
      const seasons = state.seasons.map((entry) => {
        // Resolve at the season level (no slot context) — list_seasons reports
        // each entry's effective tier for its own categories field, not for a
        // hypothetical slot drill-in. The active phase of the currently-running
        // season can win (source "phase"); source is otherwise season/game/global.
        const resolved = resolveActiveCategoriesWithSource(
          buildCascadeContext(entry, gameEntry, null, null, { at: now }),
          globalCategories,
        );
        return {
          slug: entry.slug,
          startedAt: entry.startedAt,
          expectedEndAt: entry.expectedEndAt,
          endedAt: entry.endedAt ?? null,
          ...(entry.categories !== undefined ? { categories: entry.categories } : {}),
          resolvedCategoriesCount: resolved.pool.length,
          resolvedCategoriesSource: resolved.source,
          status: statusOf(entry, now),
          ...(entry.theme !== undefined ? { theme: entry.theme } : {}),
          ...(entry.answersFormat !== undefined ? { answersFormat: entry.answersFormat } : {}),
          ...(entry.questionType !== undefined ? { questionType: entry.questionType } : {}),
          ...(entry.freeformAnswerShape !== undefined
            ? { freeformAnswerShape: entry.freeformAnswerShape }
            : {}),
          ...(entry.contexts !== undefined ? { contexts: entry.contexts } : {}),
          ...(entry.difficulty !== undefined ? { difficulty: entry.difficulty } : {}),
          ...(entry.difficultyRatio !== undefined
            ? { difficultyRatio: entry.difficultyRatio }
            : {}),
          ...(entry.format !== undefined
            ? { format: { questions: entry.format.questions.map(mapSlot) } }
            : {}),
          ...(entry.slotOverrides !== undefined
            ? {
                slotOverrides: Object.fromEntries(
                  Object.entries(entry.slotOverrides).map(([k, slot]) => [k, mapSlot(slot)]),
                ),
              }
            : {}),
          ...(entry.phases !== undefined ? { phases: buildPhaseTimeline(entry, now) } : {}),
          ...(entry.instructions !== undefined ? { instructions: entry.instructions } : {}),
          ...(entry.additionalInstructions !== undefined
            ? { additionalInstructions: entry.additionalInstructions }
            : {}),
          ...(entry.judgeInstructions !== undefined
            ? { judgeInstructions: entry.judgeInstructions }
            : {}),
          ...(entry.judgeLeniency !== undefined ? { judgeLeniency: entry.judgeLeniency } : {}),
          ...(entry.teams !== undefined ? { teams: entry.teams } : {}),
          ...(entry.teamsEnabled !== undefined ? { teamsEnabled: entry.teamsEnabled } : {}),
          ...(entry.teamsFinaleIndividuals !== undefined
            ? { teamsFinaleIndividuals: entry.teamsFinaleIndividuals }
            : {}),
          ...(entry.teamsScoring !== undefined ? { teamsScoring: entry.teamsScoring } : {}),
          ...(entry.answeringType !== undefined ? { answeringType: entry.answeringType } : {}),
          ...(entry.perfectRoundsAward !== undefined
            ? { perfectRoundsAward: entry.perfectRoundsAward }
            : {}),
          ...(entry.teamsStamp !== undefined ? { teamsStamp: entry.teamsStamp } : {}),
        };
      });
      return textResult({ game: args.game, seasons, total: seasons.length });
    },
  );
}
