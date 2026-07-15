import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../../../tools/helpers.js";
import {
  validateSeasonSlug,
  validateSeasonWindow,
  findSeasonBySlug,
  validateNoOverlap,
} from "../../core/seasonTimeline.js";
import { defaultGetGames, type GetGamesFn } from "../../core/configBridge.js";
import { requireWritableGame } from "../../core/gamesRegistry.js";
import {
  validateAnswersFormat,
  validateQuestionType,
  validatePromptMedium,
  validateFreeformAnswerShape,
  validateContexts,
  validateDifficulty,
  validateDifficultyRatio,
} from "../../domain/seasonFormat.js";
import {
  normalizeAdditionalInstructions,
  normalizeCategories,
  normalizeInstructions,
  normalizeTheme,
  seasonFormatZod,
  slotOverridesZod,
  triviaAdditionalInstructionsZod,
  triviaCategoriesZod,
  triviaInstructionsZod,
  triviaThemeZod,
  validateFormat,
  validateSlotOverrides,
} from "../../core/configParsers/format.js";
import type { TriviaDataLayer, SeasonsState, SeasonEntry } from "../../core/types.js";
import {
  REVEAL_RESPONSES_VALUES,
  answersFormatZod,
  contextsZod,
  difficultyZod,
  freeformAnswerShapeZod,
  questionTypeZod,
  promptMediumZod,
  triviaDifficultyRatioZod,
  triviaChoiceEmojiStyleZod,
  triviaPointsZod,
  triviaChoicesZod,
  triviaHintZod,
  triviaJudgeLeniencyZod,
  validateHintConfig,
  validateTriviaChoicesConfig,
  validateTriviaPoints,
} from "../../core/configParsers/axes.js";
import type {
  ChoiceEmojiStyle,
  JudgeLeniency,
  RevealResponsesMode,
  SeasonFormat,
  SeasonFormatSlot,
  TriviaAnswersFormatWeights,
  TriviaQuestionTypeWeights,
  PromptMediumWeights,
  TriviaFreeformAnswerShapeWeights,
  TriviaContextEntry,
  TriviaChoicesConfig,
  TriviaPointsConfig,
  TriviaDifficultyConfig,
  TriviaDifficultyRatioConfig,
  TriviaHintConfig,
} from "../../core/configTypes.js";

const SLOT_OVERRIDES_VS_FORMAT_MSG =
  "A season cannot set both `format` and `slotOverrides`: `format` declares the question count/structure, while `slotOverrides` layers count-decoupled per-slot deltas over the game format. Pick one.";

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
    "Create a new trivia season or update an existing one (identified by slug) within a specific game. Slug is immutable — to rename, delete + upsert. Validates no overlap within this game's timeline. On CREATE: requires startedAt + expectedEndAt. If `categories` is provided (and non-empty), the new season's pool is EXACTLY that list — use this for themed seasons. If `categories` is omitted (or `[]`), the new season is written WITHOUT a `categories` field — the pool resolves via the cascade slot → season → game → globalCategories. `categories: null` is rejected on CREATE (use omit instead). On UPDATE: applies omit-to-keep semantics; cannot mutate startedAt of an already-started season ONCE it has questions stamped to it. `categories` accepts `null` on UPDATE to CLEAR the field (drops the season back into cascade-inheritance). A non-empty `categories` array replaces the field; `[]` is rejected (pass `null` to clear). `theme`, `answersFormat`, `questionType`, `freeformAnswerShape`, `contexts`, `difficulty`, `difficultyRatio`, and `format` also accept `null` on UPDATE to clear. Use endedAt to mark a season as closed.",
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
        .nullable()
        .optional()
        .describe(
          "Season's category pool. CREATE: non-empty array → exactly that list; omitted OR `[]` → field is omitted (cascade-inheriting); `null` → rejected (use omit). UPDATE: `null` → clears the field (cascade-inheriting); non-empty array → replaces; `[]` → rejected (pass `null` to clear); omitting preserves the existing value.",
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
      promptMedium: promptMediumZod
        .nullable()
        .optional()
        .describe(
          "Optional per-season prompt-medium weights (text/image). `image` requires an installed image-search plugin at run time. On UPDATE: passing `null` clears the field. Mid-season mutation permitted.",
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
      slotOverrides: slotOverridesZod
        .nullable()
        .optional()
        .describe(
          'Optional sparse per-slot overrides keyed by GAME-format slot index (e.g. `{ "2": { promptMedium: { text: 0, image: 1 } } }`). Each value overrides that game slot field-by-field for THIS season only (the `seasonSlot` tier). COUNT-DECOUPLED — it never changes how many questions a fire posts (that stays the game format\'s slot count). Use this for "make question 3 an image question this season" without restating the whole format. MUTUALLY EXCLUSIVE with `format`: set one or the other, never both. On UPDATE: passing `null` clears the field. Mid-season mutation permitted.',
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
          'Optional per-season override for the reveal-time participation disclosure axis. `"yes"` (default) renders full named voter buckets including freeform answer text. `"just-correctness"` renders named buckets but hides typed freeform text. `"just-winners"` names ONLY the correct voters and reduces the missers to anonymous counts (winners-only flair). `"no"` renders only the answer plus reactions plus the leaderboard. On UPDATE: passing `null` clears the field. Mid-season mutation permitted.',
        ),
      instructions: triviaInstructionsZod
        .nullable()
        .optional()
        .describe(
          'Per-season tier of the replace-cascade `instructions` axis (e.g. "Halloween-themed."). Cascade: `slot → season → game → workspace → null`. Highest-precedence non-empty tier wins. Surfaced verbatim to Claude via the `get_ideas` and `process_reveal_answers` payloads. On UPDATE: passing `null` clears the field. Mid-season mutation permitted.',
        ),
      additionalInstructions: triviaAdditionalInstructionsZod
        .nullable()
        .optional()
        .describe(
          'Per-season tier of the cumulative-cascade `additionalInstructions` axis (e.g. "Favor spooky angles."). Every non-empty tier stacks — workspace + game + season + slot all apply. Surfaced verbatim to Claude via the `get_ideas` and `process_reveal_answers` payloads. On UPDATE: passing `null` clears this tier (other tiers keep theirs). Mid-season mutation permitted.',
        ),
      hint: triviaHintZod
        .nullable()
        .optional()
        .describe(
          'Per-season tier of the hint axis. Object shape `{ mode: "none" | "button" | "inline", minDifficulty?: "easy" | "medium" | "hard" }`. Cascade: `slot → season → game → workspace → { mode: "none" }`. Whole-object replace per tier. `button` is per-player opt-in safety net; `inline` is a room-wide difficulty floor adjustment — pick deliberately. On UPDATE: passing `null` clears the field. Mid-season mutation permitted.',
        ),
      judgeLeniency: triviaJudgeLeniencyZod
        .nullable()
        .optional()
        .describe(
          'Per-season tier of the reveal-judge leniency axis for freeform answers. One of `"strict"` | `"strict-with-typos"` | `"lenient"`. `"strict"` forgives only case, numeral↔word substitution, decade-form, and singular/plural; `"strict-with-typos"` (the workspace default) adds typo + loose-writing tolerance; `"lenient"` accepts any rendering that unmistakably shows the player knew the answer. Resolved at save time and stamped on each freeform question. Cascade: `slot → season → game → workspace → "strict-with-typos"`. Whole-value replace per tier. On UPDATE: passing `null` clears the field. Mid-season mutation permitted.',
        ),
      choices: triviaChoicesZod
        .nullable()
        .optional()
        .describe(
          "Per-season tier of the choice option-count bounds axis. Object shape `{ min, max }` with `2 ≤ min ≤ max ≤ 4`. Bounds how many options a `choice` question gets (get_ideas rolls a count in `[min, max]`; save_question validates against it). Cascade: `slot → season → game → workspace → { min: 4, max: 4 }`. Whole-object replace per tier. On UPDATE: passing `null` clears the field. Mid-season mutation permitted.",
        ),
      choiceEmojiStyle: triviaChoiceEmojiStyleZod
        .nullable()
        .optional()
        .describe(
          'Per-season tier of the choice-button emoji-style axis. One of `"numbers"` | `"themed"`. `"numbers"` (the built-in default) prefixes choice vote buttons with 1️⃣ 2️⃣ 3️⃣ 4️⃣; `"themed"` lets Claude pick one topic-matching Unicode emoji per option at generation time (stamped on the record, shown on buttons and the live answer roster). Purely cosmetic — never affects scoring. Cascade: `slot → season → game → workspace → "numbers"`. Whole-value replace per tier. On UPDATE: passing `null` clears the field. Mid-season mutation permitted.',
        ),
      points: triviaPointsZod
        .nullable()
        .optional()
        .describe(
          "Per-season tier of the variable-points axis. Object shape `{ max: integer 1–10, guidance?: string }`. `max` (REQUIRED) caps what one question may be worth; `guidance` is free text steering the pick. GUIDANCE IS THE SWITCH: a bare `{ max: 3 }` never makes Claude spend points — it only ALLOWS an admin to reclass a question up to 3 via override_question. Both set → get_ideas surfaces them and Claude picks `1..max` at generation, stamped by save_question. Cascade: `slot → season → game → workspace → { max: 1 }`. Whole-object replace per tier — a tier setting `guidance` must restate `max`. Already-posed questions keep their stamped value if this changes. On UPDATE: passing `null` clears the field. Mid-season mutation permitted.",
        ),
    },
    async (args) => {
      try {
        requireWritableGame(getGamesFn(), args.game);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }

      const slugCheck = validateSeasonSlug(args.slug);
      if (!slugCheck.ok) {
        return errorResult(slugCheck.error);
      }

      const scoped = data.forGame(args.game);
      const state = (await scoped.loadSeasonsState()) ?? { seasons: [] };
      const existing = findSeasonBySlug(state, args.slug);

      if (existing === null) {
        // CREATE branch
        if (args.startedAt === undefined || args.expectedEndAt === undefined) {
          return errorResult("Creating a new season requires both startedAt and expectedEndAt.");
        }
        const windowCheck = validateSeasonWindow(args.startedAt, args.expectedEndAt);
        if (!windowCheck.ok) {
          return errorResult(windowCheck.error);
        }
        if (args.endedAt !== undefined && args.endedAt <= args.startedAt) {
          return errorResult(
            `endedAt (${args.endedAt}) must be strictly greater than startedAt (${args.startedAt}).`,
          );
        }

        if (args.categories === null) {
          return errorResult(
            "Pass `categories` omitted (or `[]`) on CREATE to inherit from the cascade; `null` is reserved for UPDATE.",
          );
        }
        let categories: string[] | undefined;
        if (args.categories !== undefined && args.categories.length > 0) {
          const r = normalizeCategories(args.categories);
          if (!r.ok) return errorResult(r.error);
          categories = r.value;
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

        let promptMediumWeights: PromptMediumWeights | undefined;
        if (args.promptMedium !== undefined && args.promptMedium !== null) {
          const validated = validatePromptMedium(compactNumberMap(args.promptMedium));
          if (!validated.ok) return errorResult(validated.error);
          promptMediumWeights = validated.value;
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

        let slotOverrides: Record<number, SeasonFormatSlot> | undefined;
        if (args.slotOverrides !== undefined && args.slotOverrides !== null) {
          const validated = validateSlotOverrides(args.slotOverrides);
          if (!validated.ok) return errorResult(validated.error);
          slotOverrides = validated.value;
        }
        if (format !== undefined && slotOverrides !== undefined) {
          return errorResult(SLOT_OVERRIDES_VS_FORMAT_MSG);
        }

        let theme: string | undefined;
        if (args.theme !== undefined && args.theme !== null) {
          const normalized = normalizeTheme(args.theme);
          if (!normalized.ok) return errorResult(normalized.error);
          theme = normalized.value;
        }

        let instructions: string | undefined;
        if (args.instructions !== undefined && args.instructions !== null) {
          const normalized = normalizeInstructions(args.instructions);
          if (!normalized.ok) return errorResult(normalized.error);
          instructions = normalized.value;
        }

        let additionalInstructions: string | undefined;
        if (args.additionalInstructions !== undefined && args.additionalInstructions !== null) {
          const normalized = normalizeAdditionalInstructions(args.additionalInstructions);
          if (!normalized.ok) return errorResult(normalized.error);
          additionalInstructions = normalized.value;
        }

        let hint: TriviaHintConfig | undefined;
        if (args.hint !== undefined && args.hint !== null) {
          const validated = validateHintConfig(args.hint, "hint");
          if (!validated.ok) return errorResult(validated.error);
          hint = validated.value;
        }

        const judgeLeniency: JudgeLeniency | undefined =
          args.judgeLeniency === undefined || args.judgeLeniency === null
            ? undefined
            : args.judgeLeniency;

        let choices: TriviaChoicesConfig | undefined;
        if (args.choices !== undefined && args.choices !== null) {
          const validated = validateTriviaChoicesConfig(args.choices, "choices");
          if (!validated.ok) return errorResult(validated.error);
          choices = validated.value;
        }

        const choiceEmojiStyle: ChoiceEmojiStyle | undefined =
          args.choiceEmojiStyle === undefined || args.choiceEmojiStyle === null
            ? undefined
            : args.choiceEmojiStyle;

        let points: TriviaPointsConfig | undefined;
        if (args.points !== undefined && args.points !== null) {
          const validated = validateTriviaPoints(args.points, "points");
          if (!validated.ok) return errorResult(validated.error);
          points = validated.value;
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
          ...(categories !== undefined ? { categories } : {}),
          ...(answersFormatWeights !== undefined ? { answersFormat: answersFormatWeights } : {}),
          ...(questionTypeWeights !== undefined ? { questionType: questionTypeWeights } : {}),
          ...(promptMediumWeights !== undefined ? { promptMedium: promptMediumWeights } : {}),
          ...(freeformAnswerShapeWeights !== undefined
            ? { freeformAnswerShape: freeformAnswerShapeWeights }
            : {}),
          ...(contexts !== undefined ? { contexts } : {}),
          ...(difficulty !== undefined ? { difficulty } : {}),
          ...(difficultyRatio !== undefined ? { difficultyRatio } : {}),
          ...(format !== undefined ? { format } : {}),
          ...(slotOverrides !== undefined ? { slotOverrides } : {}),
          ...(liveAnswersVisible !== undefined ? { liveAnswersVisible } : {}),
          ...(revealResponses !== undefined ? { revealResponses } : {}),
          ...(instructions !== undefined ? { instructions } : {}),
          ...(additionalInstructions !== undefined ? { additionalInstructions } : {}),
          ...(hint !== undefined ? { hint } : {}),
          ...(judgeLeniency !== undefined ? { judgeLeniency } : {}),
          ...(choices !== undefined ? { choices } : {}),
          ...(choiceEmojiStyle !== undefined ? { choiceEmojiStyle } : {}),
          ...(points !== undefined ? { points } : {}),
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
          hasCategories: entry.categories !== undefined,
          inheritsCategories: entry.categories === undefined,
          categoriesCount: entry.categories?.length ?? 0,
          hasTheme: entry.theme !== undefined,
          hasAnswersFormat: entry.answersFormat !== undefined,
          hasQuestionType: entry.questionType !== undefined,
          hasFreeformAnswerShape: entry.freeformAnswerShape !== undefined,
          hasContexts: entry.contexts !== undefined,
          hasDifficulty: entry.difficulty !== undefined,
          hasDifficultyRatio: entry.difficultyRatio !== undefined,
          hasFormat: entry.format !== undefined,
          slotCount: entry.format?.questions.length ?? 0,
          hasSlotOverrides: entry.slotOverrides !== undefined,
          hasLiveAnswersVisible: entry.liveAnswersVisible !== undefined,
          hasRevealResponses: entry.revealResponses !== undefined,
          hasInstructions: entry.instructions !== undefined,
          hasAdditionalInstructions: entry.additionalInstructions !== undefined,
          hasHint: entry.hint !== undefined,
          hasJudgeLeniency: entry.judgeLeniency !== undefined,
          hasChoices: entry.choices !== undefined,
          hasChoiceEmojiStyle: entry.choiceEmojiStyle !== undefined,
          hasPoints: entry.points !== undefined,
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

      let updatedCategories: string[] | undefined = existing.categories;
      if (args.categories === null) {
        updatedCategories = undefined;
      } else if (args.categories !== undefined) {
        if (args.categories.length === 0) {
          return errorResult(
            "Empty `categories` array on update — pass null to clear (drops the season back into cascade-inheritance) or pass a non-empty list to replace.",
          );
        }
        const normalized = normalizeCategories(args.categories);
        if (!normalized.ok) return errorResult(normalized.error);
        updatedCategories = normalized.value;
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

      let updatedPromptMedium: PromptMediumWeights | undefined = existing.promptMedium;
      if (args.promptMedium === null) {
        updatedPromptMedium = undefined;
      } else if (args.promptMedium !== undefined) {
        const validated = validatePromptMedium(compactNumberMap(args.promptMedium));
        if (!validated.ok) return errorResult(validated.error);
        updatedPromptMedium = validated.value;
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

      let updatedSlotOverrides: Record<number, SeasonFormatSlot> | undefined =
        existing.slotOverrides;
      if (args.slotOverrides === null) {
        updatedSlotOverrides = undefined;
      } else if (args.slotOverrides !== undefined) {
        const validated = validateSlotOverrides(args.slotOverrides);
        if (!validated.ok) return errorResult(validated.error);
        updatedSlotOverrides = validated.value;
      }
      if (updatedFormat !== undefined && updatedSlotOverrides !== undefined) {
        return errorResult(SLOT_OVERRIDES_VS_FORMAT_MSG);
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

      let updatedInstructions: string | undefined = existing.instructions;
      if (args.instructions === null) {
        updatedInstructions = undefined;
      } else if (args.instructions !== undefined) {
        const normalized = normalizeInstructions(args.instructions);
        if (!normalized.ok) return errorResult(normalized.error);
        updatedInstructions = normalized.value;
      }

      let updatedAdditionalInstructions: string | undefined = existing.additionalInstructions;
      if (args.additionalInstructions === null) {
        updatedAdditionalInstructions = undefined;
      } else if (args.additionalInstructions !== undefined) {
        const normalized = normalizeAdditionalInstructions(args.additionalInstructions);
        if (!normalized.ok) return errorResult(normalized.error);
        updatedAdditionalInstructions = normalized.value;
      }

      let updatedHint: TriviaHintConfig | undefined = existing.hint;
      if (args.hint === null) {
        updatedHint = undefined;
      } else if (args.hint !== undefined) {
        const validated = validateHintConfig(args.hint, "hint");
        if (!validated.ok) return errorResult(validated.error);
        updatedHint = validated.value;
      }

      let updatedJudgeLeniency: JudgeLeniency | undefined = existing.judgeLeniency;
      if (args.judgeLeniency === null) {
        updatedJudgeLeniency = undefined;
      } else if (args.judgeLeniency !== undefined) {
        updatedJudgeLeniency = args.judgeLeniency;
      }

      let updatedChoices: TriviaChoicesConfig | undefined = existing.choices;
      if (args.choices === null) {
        updatedChoices = undefined;
      } else if (args.choices !== undefined) {
        const validated = validateTriviaChoicesConfig(args.choices, "choices");
        if (!validated.ok) return errorResult(validated.error);
        updatedChoices = validated.value;
      }

      let updatedChoiceEmojiStyle: ChoiceEmojiStyle | undefined = existing.choiceEmojiStyle;
      if (args.choiceEmojiStyle === null) {
        updatedChoiceEmojiStyle = undefined;
      } else if (args.choiceEmojiStyle !== undefined) {
        updatedChoiceEmojiStyle = args.choiceEmojiStyle;
      }

      let updatedPoints: TriviaPointsConfig | undefined = existing.points;
      if (args.points === null) {
        updatedPoints = undefined;
      } else if (args.points !== undefined) {
        const validated = validateTriviaPoints(args.points, "points");
        if (!validated.ok) return errorResult(validated.error);
        updatedPoints = validated.value;
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
        ...(updatedCategories !== undefined ? { categories: updatedCategories } : {}),
        ...(updatedAnswersFormat !== undefined ? { answersFormat: updatedAnswersFormat } : {}),
        ...(updatedQuestionType !== undefined ? { questionType: updatedQuestionType } : {}),
        ...(updatedPromptMedium !== undefined ? { promptMedium: updatedPromptMedium } : {}),
        ...(updatedFreeformAnswerShape !== undefined
          ? { freeformAnswerShape: updatedFreeformAnswerShape }
          : {}),
        ...(updatedContexts !== undefined ? { contexts: updatedContexts } : {}),
        ...(updatedDifficulty !== undefined ? { difficulty: updatedDifficulty } : {}),
        ...(updatedDifficultyRatio !== undefined
          ? { difficultyRatio: updatedDifficultyRatio }
          : {}),
        ...(updatedFormat !== undefined ? { format: updatedFormat } : {}),
        ...(updatedSlotOverrides !== undefined ? { slotOverrides: updatedSlotOverrides } : {}),
        ...(updatedLiveAnswersVisible !== undefined
          ? { liveAnswersVisible: updatedLiveAnswersVisible }
          : {}),
        ...(updatedRevealResponses !== undefined
          ? { revealResponses: updatedRevealResponses }
          : {}),
        ...(updatedInstructions !== undefined ? { instructions: updatedInstructions } : {}),
        ...(updatedAdditionalInstructions !== undefined
          ? { additionalInstructions: updatedAdditionalInstructions }
          : {}),
        ...(updatedHint !== undefined ? { hint: updatedHint } : {}),
        ...(updatedJudgeLeniency !== undefined ? { judgeLeniency: updatedJudgeLeniency } : {}),
        ...(updatedChoices !== undefined ? { choices: updatedChoices } : {}),
        ...(updatedChoiceEmojiStyle !== undefined
          ? { choiceEmojiStyle: updatedChoiceEmojiStyle }
          : {}),
        ...(updatedPoints !== undefined ? { points: updatedPoints } : {}),
      };

      const effectiveEnd = updated.endedAt ?? updated.expectedEndAt;
      if (updated.startedAt >= effectiveEnd) {
        return errorResult(
          `After update, startedAt (${updated.startedAt}) is no longer strictly less than (endedAt ?? expectedEndAt) (${effectiveEnd}).`,
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
        hasCategories: updated.categories !== undefined,
        inheritsCategories: updated.categories === undefined,
        categoriesCount: updated.categories?.length ?? 0,
        hasTheme: updated.theme !== undefined,
        hasAnswersFormat: updated.answersFormat !== undefined,
        hasQuestionType: updated.questionType !== undefined,
        hasFreeformAnswerShape: updated.freeformAnswerShape !== undefined,
        hasContexts: updated.contexts !== undefined,
        hasDifficulty: updated.difficulty !== undefined,
        hasDifficultyRatio: updated.difficultyRatio !== undefined,
        hasFormat: updated.format !== undefined,
        slotCount: updated.format?.questions.length ?? 0,
        hasSlotOverrides: updated.slotOverrides !== undefined,
        hasLiveAnswersVisible: updated.liveAnswersVisible !== undefined,
        hasRevealResponses: updated.revealResponses !== undefined,
        hasInstructions: updated.instructions !== undefined,
        hasAdditionalInstructions: updated.additionalInstructions !== undefined,
        hasHint: updated.hint !== undefined,
        hasJudgeLeniency: updated.judgeLeniency !== undefined,
        hasChoices: updated.choices !== undefined,
        hasChoiceEmojiStyle: updated.choiceEmojiStyle !== undefined,
        hasPoints: updated.points !== undefined,
      });
    },
  );
}
