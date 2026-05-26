import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../../../tools/helpers.js";
import { findSeasonBySlug, validateNoOverlap } from "../../core/seasonTimeline.js";
import { defaultGetGames, type GetGamesFn } from "../../core/configBridge.js";
import { requireWritableGame } from "../../core/gamesRegistry.js";
import {
  validateAnswersFormat,
  validateQuestionType,
  validateFreeformAnswerShape,
  validateContexts,
  validateDifficulty,
  validateDifficultyRatio,
} from "../../domain/seasonFormat.js";
import {
  normalizeCategories,
  normalizeTheme,
  seasonFormatZod,
  triviaCategoriesZod,
  triviaThemeZod,
  validateFormat,
} from "../../core/configParsers/format.js";
import type { TriviaDataLayer, SeasonsState, SeasonEntry } from "../../core/types.js";
import {
  REVEAL_RESPONSES_VALUES,
  answersFormatZod,
  contextsZod,
  difficultyZod,
  freeformAnswerShapeZod,
  questionTypeZod,
  triviaDifficultyRatioZod,
} from "../../core/configParsers/axes.js";
import type {
  RevealResponsesMode,
  SeasonFormat,
  TriviaAnswersFormatWeights,
  TriviaQuestionTypeWeights,
  TriviaFreeformAnswerShapeWeights,
  TriviaContextEntry,
  TriviaDifficultyConfig,
  TriviaDifficultyRatioConfig,
} from "../../core/configTypes.js";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Strip undefined entries from a zod-typed optional-keys map so the underlying
 * validator (which iterates Object.entries and rejects undefined) sees a clean
 * sparse JSON object. JSON literals never carry undefined; this just bridges
 * the zod-typed shape into the validator's expected input shape.
 */
function compactNumberMap(raw: Record<string, number | undefined>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "number") out[k] = v;
  }
  return out;
}

export function createUpsertSeasonTool(
  data: TriviaDataLayer,
  getGamesFn: GetGamesFn = defaultGetGames,
) {
  return tool(
    "upsert_season",
    "Create a new trivia season or update an existing one (identified by slug) within a specific game. Slug is immutable — to rename, delete + upsert. Validates no overlap within this game's timeline. On CREATE: requires startedAt + expectedEndAt. If `categories` is provided (and non-empty), the new season's pool is EXACTLY that list — use this for themed seasons. If `categories` is omitted or empty, the new season's pool is copied from the global categories.json. On UPDATE: applies omit-to-keep semantics; cannot mutate startedAt of an already-started season ONCE it has questions stamped to it (a started-but-empty season is still freely editable); `categories` is ignored on UPDATE — use add_categories/remove_categories with target slug to refine. `theme`, `answersFormat`, `questionType`, `freeformAnswerShape`, and `contexts` all accept `null` on UPDATE to clear the field. `theme` is a short human-readable narrative label (e.g. \"Halloween Spooktacular\") surfaced at the top of the season's first question post. Use endedAt to mark a season as closed.",
    {
      game: z
        .string()
        .describe(
          "Game name (must be present in config.trivia.games[] and not disabled). The season operation targets this game's seasons.json.",
        ),
      slug: z
        .string()
        .describe(
          "Non-empty kebab-case identifier. Treated as immutable key (no rename via this tool). Unique within this game's timeline.",
        ),
      startedAt: z.number().optional().describe("Unix-ms when the season's active window begins."),
      expectedEndAt: z
        .number()
        .optional()
        .describe("Unix-ms when the season's active window is expected to close."),
      endedAt: z
        .number()
        .optional()
        .describe("Unix-ms when the season was actually closed. Set this to mark a season ended."),
      categories: triviaCategoriesZod
        .optional()
        .describe(
          "Season's category pool. Provided AND non-empty → the season uses EXACTLY this list. Omitted OR empty → copies from the global categories.json. Used only on CREATE.",
        ),
      theme: triviaThemeZod
        .nullable()
        .optional()
        .describe(
          'Optional short human-readable narrative label (e.g. "Halloween Spooktacular") surfaced at the top of the season\'s first question post. On UPDATE: passing `null` clears the field; omitting preserves the existing value. Empty / whitespace-only strings are rejected.',
        ),
      answersFormat: answersFormatZod
        .nullable()
        .optional()
        .describe(
          "Optional per-season answer-format weights (boolean/choice/freeform). On UPDATE: passing `null` clears the field. Mid-season mutation permitted.",
        ),
      questionType: questionTypeZod
        .nullable()
        .optional()
        .describe(
          "Optional per-season fact-vs-topical weights. On UPDATE: passing `null` clears the field. Mid-season mutation permitted.",
        ),
      freeformAnswerShape: freeformAnswerShapeZod
        .nullable()
        .optional()
        .describe(
          "Optional per-season freeform answer-shape weights (name/place/phrase/title/date/countable/other). Affects freeform questions only — boolean/choice ignore. `other` is a wildcard slot where Claude picks an unconventional shape. On UPDATE: passing `null` clears the field. Mid-season mutation permitted.",
        ),
      contexts: contextsZod
        .nullable()
        .optional()
        .describe(
          "Optional per-season lens list (e.g. Quebec, International, academic). On UPDATE: passing `null` clears the field. Mid-season mutation permitted.",
        ),
      difficulty: difficultyZod
        .nullable()
        .optional()
        .describe(
          "Optional per-season per-game-type difficulty overrides. Object keyed by `boolean` / `choice` / `freeform`; each value is a sparse `{ easy?: [min, max], medium?: [min, max], hard?: [min, max] }` on the 1–10 scale. Fields cascade independently — overriding just `freeform.hard` is fine. On UPDATE: passing `null` clears the field. Mid-season mutation permitted.",
        ),
      difficultyRatio: triviaDifficultyRatioZod
        .nullable()
        .optional()
        .describe(
          "Optional per-season per-game-type bucket-roll ratio. Object keyed by `boolean` / `choice` / `freeform`; each value is `{ easy?, medium?, hard? }` non-negative integer weights with at least one strictly positive. Whole-object replace per cascade tier (slot → season → game → workspace → built-in default). On UPDATE: passing `null` clears the field. Mid-season mutation permitted.",
        ),
      format: seasonFormatZod
        .nullable()
        .optional()
        .describe(
          "Optional per-season question composition. When set, each question-cron fire posts `format.questions.length` questions in slot order. Each slot may narrow `label` / `categories` / `answersFormat` / `questionType` / `freeformAnswerShape` / `contexts` / `difficulty` / `liveAnswersVisible` / `revealResponses`; missing fields cascade to the season's defaults. On UPDATE: object value replaces the whole format; explicit `null` clears the field; mid-season mutation permitted.",
        ),
      liveAnswersVisible: z
        .boolean()
        .nullable()
        .optional()
        .describe(
          'Optional per-season override for the live-roster-footer visibility axis. When `true` (the cascaded default), the live "📝 Answered" footer reveals each answerer\'s pick alongside their name. When `false`, the footer shows only names. On UPDATE: passing `null` clears the field. Mid-season mutation permitted.',
        ),
      revealResponses: z
        .enum(REVEAL_RESPONSES_VALUES as readonly [RevealResponsesMode, ...RevealResponsesMode[]])
        .nullable()
        .optional()
        .describe(
          'Optional per-season override for the reveal-time participation disclosure axis. `"yes"` (default) renders full named voter buckets including freeform answer text. `"just-correctness"` renders named buckets but hides typed freeform text. `"no"` renders only the answer plus reactions plus the leaderboard. On UPDATE: passing `null` clears the field. Mid-season mutation permitted.',
        ),
    },
    async (args) => {
      try {
        requireWritableGame(getGamesFn(), args.game);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }

      if (!SLUG_RE.test(args.slug)) {
        return errorResult(
          `Invalid slug "${args.slug}": must be non-empty kebab-case (lowercase letters/digits, segments separated by single hyphens).`,
        );
      }

      const scoped = data.forGame(args.game);
      const state = (await scoped.loadSeasonsState()) ?? { seasons: [] };
      const existing = findSeasonBySlug(state, args.slug);

      if (existing === null) {
        // CREATE branch
        if (args.startedAt === undefined || args.expectedEndAt === undefined) {
          return errorResult("Creating a new season requires both startedAt and expectedEndAt.");
        }
        if (args.startedAt >= args.expectedEndAt) {
          return errorResult(
            `startedAt (${args.startedAt}) must be strictly less than expectedEndAt (${args.expectedEndAt}).`,
          );
        }
        if (args.endedAt !== undefined && args.endedAt <= args.startedAt) {
          return errorResult(
            `endedAt (${args.endedAt}) must be strictly greater than startedAt (${args.startedAt}).`,
          );
        }

        let categories: string[];
        if (args.categories !== undefined && args.categories.length > 0) {
          const r = normalizeCategories(args.categories);
          if (!r.ok) return errorResult(r.error);
          categories = r.value;
        } else {
          categories = [...(await data.loadCategories())];
        }
        if (categories.length === 0) {
          return errorResult(
            "Cannot create a season with zero categories. Add at least one entry to categories.json or pass a non-empty `categories` array.",
          );
        }

        let answersFormatWeights: TriviaAnswersFormatWeights | undefined;
        if (args.answersFormat !== undefined && args.answersFormat !== null) {
          const validated = validateAnswersFormat(compactNumberMap(args.answersFormat));
          if (!validated.ok) return errorResult(validated.error);
          answersFormatWeights = validated.value;
        }

        let questionTypeWeights: TriviaQuestionTypeWeights | undefined;
        if (args.questionType !== undefined && args.questionType !== null) {
          const validated = validateQuestionType(compactNumberMap(args.questionType));
          if (!validated.ok) return errorResult(validated.error);
          questionTypeWeights = validated.value;
        }

        let freeformAnswerShapeWeights: TriviaFreeformAnswerShapeWeights | undefined;
        if (args.freeformAnswerShape !== undefined && args.freeformAnswerShape !== null) {
          const validated = validateFreeformAnswerShape(compactNumberMap(args.freeformAnswerShape));
          if (!validated.ok) return errorResult(validated.error);
          freeformAnswerShapeWeights = validated.value;
        }

        let contexts: TriviaContextEntry[] | undefined;
        if (args.contexts !== undefined && args.contexts !== null) {
          const validated = validateContexts(args.contexts);
          if (!validated.ok) return errorResult(validated.error);
          contexts = validated.value;
        }

        let difficulty: TriviaDifficultyConfig | undefined;
        if (args.difficulty !== undefined && args.difficulty !== null) {
          const validated = validateDifficulty(args.difficulty);
          if (!validated.ok) return errorResult(validated.error);
          difficulty = validated.value;
        }

        let difficultyRatio: TriviaDifficultyRatioConfig | undefined;
        if (args.difficultyRatio !== undefined && args.difficultyRatio !== null) {
          const validated = validateDifficultyRatio(args.difficultyRatio);
          if (!validated.ok) return errorResult(validated.error);
          difficultyRatio = validated.value;
        }

        let format: SeasonFormat | undefined;
        if (args.format !== undefined && args.format !== null) {
          const validated = validateFormat(args.format);
          if (!validated.ok) return errorResult(validated.error);
          format = validated.value;
        }

        let theme: string | undefined;
        if (args.theme !== undefined && args.theme !== null) {
          const normalized = normalizeTheme(args.theme);
          if (!normalized.ok) return errorResult(normalized.error);
          theme = normalized.value;
        }

        const liveAnswersVisible: boolean | undefined =
          args.liveAnswersVisible === undefined || args.liveAnswersVisible === null
            ? undefined
            : args.liveAnswersVisible;

        const revealResponses: RevealResponsesMode | undefined =
          args.revealResponses === undefined || args.revealResponses === null
            ? undefined
            : args.revealResponses;

        const entry: SeasonEntry = {
          slug: args.slug,
          startedAt: args.startedAt,
          expectedEndAt: args.expectedEndAt,
          ...(args.endedAt !== undefined ? { endedAt: args.endedAt } : {}),
          ...(theme !== undefined ? { theme } : {}),
          categories,
          ...(answersFormatWeights !== undefined ? { answersFormat: answersFormatWeights } : {}),
          ...(questionTypeWeights !== undefined ? { questionType: questionTypeWeights } : {}),
          ...(freeformAnswerShapeWeights !== undefined
            ? { freeformAnswerShape: freeformAnswerShapeWeights }
            : {}),
          ...(contexts !== undefined ? { contexts } : {}),
          ...(difficulty !== undefined ? { difficulty } : {}),
          ...(difficultyRatio !== undefined ? { difficultyRatio } : {}),
          ...(format !== undefined ? { format } : {}),
          ...(liveAnswersVisible !== undefined ? { liveAnswersVisible } : {}),
          ...(revealResponses !== undefined ? { revealResponses } : {}),
        };

        try {
          validateNoOverlap(state, entry);
        } catch (err) {
          return errorResult(err instanceof Error ? err.message : String(err));
        }

        const next: SeasonsState = { seasons: [...state.seasons, entry] };
        await scoped.saveSeasonsState(next);

        return textResult({
          game: args.game,
          slug: entry.slug,
          action: "created",
          startedAt: entry.startedAt,
          expectedEndAt: entry.expectedEndAt,
          endedAt: entry.endedAt ?? null,
          categoriesCount: entry.categories.length,
          hasTheme: entry.theme !== undefined,
          hasAnswersFormat: entry.answersFormat !== undefined,
          hasQuestionType: entry.questionType !== undefined,
          hasFreeformAnswerShape: entry.freeformAnswerShape !== undefined,
          hasContexts: entry.contexts !== undefined,
          hasDifficulty: entry.difficulty !== undefined,
          hasDifficultyRatio: entry.difficultyRatio !== undefined,
          hasFormat: entry.format !== undefined,
          slotCount: entry.format?.questions.length ?? 0,
          hasLiveAnswersVisible: entry.liveAnswersVisible !== undefined,
          hasRevealResponses: entry.revealResponses !== undefined,
        });
      }

      // UPDATE branch
      const now = Date.now();
      if (args.startedAt !== undefined && args.startedAt !== existing.startedAt) {
        if (existing.startedAt <= now) {
          const questions = await scoped.loadQuestions();
          const hasStampedQuestions = questions.some((q) => q.season === args.slug);
          if (hasStampedQuestions) {
            return errorResult(
              `Cannot shift startedAt of an already-started season "${args.slug}" once questions have been recorded under it. The past is immutable; edit seasons.json directly for emergency corrections.`,
            );
          }
        }
      }

      let updatedAnswersFormat: TriviaAnswersFormatWeights | undefined = existing.answersFormat;
      if (args.answersFormat === null) {
        updatedAnswersFormat = undefined;
      } else if (args.answersFormat !== undefined) {
        const validated = validateAnswersFormat(compactNumberMap(args.answersFormat));
        if (!validated.ok) return errorResult(validated.error);
        updatedAnswersFormat = validated.value;
      }

      let updatedQuestionType: TriviaQuestionTypeWeights | undefined = existing.questionType;
      if (args.questionType === null) {
        updatedQuestionType = undefined;
      } else if (args.questionType !== undefined) {
        const validated = validateQuestionType(compactNumberMap(args.questionType));
        if (!validated.ok) return errorResult(validated.error);
        updatedQuestionType = validated.value;
      }

      let updatedFreeformAnswerShape: TriviaFreeformAnswerShapeWeights | undefined =
        existing.freeformAnswerShape;
      if (args.freeformAnswerShape === null) {
        updatedFreeformAnswerShape = undefined;
      } else if (args.freeformAnswerShape !== undefined) {
        const validated = validateFreeformAnswerShape(compactNumberMap(args.freeformAnswerShape));
        if (!validated.ok) return errorResult(validated.error);
        updatedFreeformAnswerShape = validated.value;
      }

      let updatedContexts: TriviaContextEntry[] | undefined = existing.contexts;
      if (args.contexts === null) {
        updatedContexts = undefined;
      } else if (args.contexts !== undefined) {
        const validated = validateContexts(args.contexts);
        if (!validated.ok) return errorResult(validated.error);
        updatedContexts = validated.value;
      }

      let updatedDifficulty: TriviaDifficultyConfig | undefined = existing.difficulty;
      if (args.difficulty === null) {
        updatedDifficulty = undefined;
      } else if (args.difficulty !== undefined) {
        const validated = validateDifficulty(args.difficulty);
        if (!validated.ok) return errorResult(validated.error);
        updatedDifficulty = validated.value;
      }

      let updatedDifficultyRatio: TriviaDifficultyRatioConfig | undefined =
        existing.difficultyRatio;
      if (args.difficultyRatio === null) {
        updatedDifficultyRatio = undefined;
      } else if (args.difficultyRatio !== undefined) {
        const validated = validateDifficultyRatio(args.difficultyRatio);
        if (!validated.ok) return errorResult(validated.error);
        updatedDifficultyRatio = validated.value;
      }

      let updatedFormat: SeasonFormat | undefined = existing.format;
      if (args.format === null) {
        updatedFormat = undefined;
      } else if (args.format !== undefined) {
        const validated = validateFormat(args.format);
        if (!validated.ok) return errorResult(validated.error);
        updatedFormat = validated.value;
      }

      let updatedTheme: string | undefined = existing.theme;
      if (args.theme === null) {
        updatedTheme = undefined;
      } else if (args.theme !== undefined) {
        const normalized = normalizeTheme(args.theme);
        if (!normalized.ok) return errorResult(normalized.error);
        updatedTheme = normalized.value;
      }

      let updatedLiveAnswersVisible: boolean | undefined = existing.liveAnswersVisible;
      if (args.liveAnswersVisible === null) {
        updatedLiveAnswersVisible = undefined;
      } else if (args.liveAnswersVisible !== undefined) {
        updatedLiveAnswersVisible = args.liveAnswersVisible;
      }

      let updatedRevealResponses: RevealResponsesMode | undefined = existing.revealResponses;
      if (args.revealResponses === null) {
        updatedRevealResponses = undefined;
      } else if (args.revealResponses !== undefined) {
        updatedRevealResponses = args.revealResponses;
      }

      const updated: SeasonEntry = {
        slug: existing.slug,
        startedAt: args.startedAt ?? existing.startedAt,
        expectedEndAt: args.expectedEndAt ?? existing.expectedEndAt,
        ...(args.endedAt !== undefined
          ? { endedAt: args.endedAt }
          : existing.endedAt !== undefined
            ? { endedAt: existing.endedAt }
            : {}),
        ...(updatedTheme !== undefined ? { theme: updatedTheme } : {}),
        categories: existing.categories,
        ...(updatedAnswersFormat !== undefined ? { answersFormat: updatedAnswersFormat } : {}),
        ...(updatedQuestionType !== undefined ? { questionType: updatedQuestionType } : {}),
        ...(updatedFreeformAnswerShape !== undefined
          ? { freeformAnswerShape: updatedFreeformAnswerShape }
          : {}),
        ...(updatedContexts !== undefined ? { contexts: updatedContexts } : {}),
        ...(updatedDifficulty !== undefined ? { difficulty: updatedDifficulty } : {}),
        ...(updatedDifficultyRatio !== undefined
          ? { difficultyRatio: updatedDifficultyRatio }
          : {}),
        ...(updatedFormat !== undefined ? { format: updatedFormat } : {}),
        ...(updatedLiveAnswersVisible !== undefined
          ? { liveAnswersVisible: updatedLiveAnswersVisible }
          : {}),
        ...(updatedRevealResponses !== undefined
          ? { revealResponses: updatedRevealResponses }
          : {}),
      };

      const effectiveEnd = updated.endedAt ?? updated.expectedEndAt;
      if (updated.startedAt >= effectiveEnd) {
        return errorResult(
          `After update, startedAt (${updated.startedAt}) is no longer strictly less than (endedAt ?? expectedEndAt) (${effectiveEnd}).`,
        );
      }

      if (updated.categories.length === 0) {
        return errorResult(
          `Season "${args.slug}" would have zero categories after update — rejected.`,
        );
      }

      try {
        validateNoOverlap(state, updated, args.slug);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }

      const nextSeasons = state.seasons.map((s) => (s.slug === args.slug ? updated : s));
      await scoped.saveSeasonsState({ seasons: nextSeasons });

      return textResult({
        game: args.game,
        slug: updated.slug,
        action: "updated",
        startedAt: updated.startedAt,
        expectedEndAt: updated.expectedEndAt,
        endedAt: updated.endedAt ?? null,
        categoriesCount: updated.categories.length,
        hasTheme: updated.theme !== undefined,
        hasAnswersFormat: updated.answersFormat !== undefined,
        hasQuestionType: updated.questionType !== undefined,
        hasFreeformAnswerShape: updated.freeformAnswerShape !== undefined,
        hasContexts: updated.contexts !== undefined,
        hasDifficulty: updated.difficulty !== undefined,
        hasDifficultyRatio: updated.difficultyRatio !== undefined,
        hasFormat: updated.format !== undefined,
        slotCount: updated.format?.questions.length ?? 0,
        hasLiveAnswersVisible: updated.liveAnswersVisible !== undefined,
        hasRevealResponses: updated.revealResponses !== undefined,
      });
    },
  );
}
