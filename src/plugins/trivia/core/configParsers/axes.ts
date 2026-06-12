/**
 * Cascading-axis validation for the trivia config (answersFormat, questionType,
 * promptMedium, freeformAnswerShape, contexts, difficulty, difficultyRatio, …).
 *
 * Each concept is ONE zod schema, composed from the pure primitives in
 * `axisCheckers.ts`. The exported `validate*` functions are thin adapters:
 * `safeParse` the schema, then format any error via the SDK's `zodErrorToResult`.
 * Both the strict tool path and the lenient file-load path call the same
 * adapters, so shape AND semantics have a single source of truth. The thin
 * `*Zod` schemas further down are the structural arg schemas the MCP tool
 * boundary needs.
 */

import { z } from "zod";
import type {
  ChoiceEmojiStyle,
  DifficultyBucketWeights,
  DifficultyRangesInput,
  HintMode,
  JsonObject,
  JsonValue,
  JudgeLeniency,
  RevealResponsesMode,
  TriviaAllTimeRowMode,
  TriviaAnswersFormatWeights,
  TriviaChoicesConfig,
  TriviaContextEntry,
  TriviaDifficultyConfig,
  TriviaDifficultyRatioConfig,
  TriviaFinalRevealSummary,
  TriviaFreeformAnswerShapeWeights,
  TriviaHintConfig,
  TriviaIncludeRevealInQuestions,
  TriviaQuestionTypeWeights,
  TriviaTellMeMoreConfig,
  PromptMediumWeights,
} from "../configTypes.js";
import {
  ALL_TIME_ROW_KEYS,
  CHOICE_EMOJI_STYLE_KEYS,
  DEFAULT_TRIVIA_CHOICES,
  FINAL_REVEAL_SUMMARY_KEYS,
  INCLUDE_REVEAL_IN_QUESTIONS_KEYS,
  JUDGE_LENIENCY_KEYS,
} from "../configTypes.js";
import { type Result } from "../../../zodResult.js";
import {
  choicesCheck,
  contextsCheck,
  enumCheck,
  hintCheck,
  isJsonObject,
  normalizeContexts,
  normalizeWeights,
  perFormatCheck,
  rangesMapCheck,
  safeParseToResult,
  schemaFromChecker,
  weightMapCheck,
} from "./axisCheckers.js";

/** One issue surfaced while parsing. `field` is a dot-joined path like `trivia.games[0].answersFormat`. */
export interface ParseIssue {
  field: string;
  error: string;
}

export const ANSWERS_FORMAT_KEYS = ["boolean", "choice", "freeform"] as const;
export const QUESTION_TYPE_KEYS = ["fact", "topical", "prediction"] as const;
export const PROMPT_MEDIUM_KEYS = ["text", "image"] as const;
export const FREEFORM_ANSWER_SHAPE_KEYS = [
  "name",
  "place",
  "phrase",
  "title",
  "date",
  "countable",
  "other",
] as const;
export const DIFFICULTY_BUCKET_KEYS = ["easy", "medium", "hard"] as const;
export const DIFFICULTY_FORMAT_KEYS = ["boolean", "choice", "freeform"] as const;
export const HINT_MODE_KEYS = ["none", "button", "inline"] as const;
const HINT_ALLOWED_FIELDS = ["mode", "minDifficulty"] as const;

/** The literal string set for `revealResponses` — shared across tiers. */
export const REVEAL_RESPONSES_VALUES = ["no", "just-winners", "just-correctness", "yes"] as const;

/**
 * Type guard for `revealResponses`. Lenient — callers decide how to react
 * (drop-with-warning at config parse, throw at upsert tools).
 */
export function isRevealResponsesMode(raw: unknown): raw is RevealResponsesMode {
  return typeof raw === "string" && (REVEAL_RESPONSES_VALUES as readonly string[]).includes(raw);
}

// --- Weight maps -----------------------------------------------------------

const answersFormatSchema: z.ZodType<TriviaAnswersFormatWeights> = schemaFromChecker(
  (raw) => weightMapCheck(raw, ANSWERS_FORMAT_KEYS, []),
  (raw) => normalizeWeights(raw, ANSWERS_FORMAT_KEYS),
);
const questionTypeSchema: z.ZodType<TriviaQuestionTypeWeights> = schemaFromChecker(
  (raw) => weightMapCheck(raw, QUESTION_TYPE_KEYS, []),
  (raw) => normalizeWeights(raw, QUESTION_TYPE_KEYS),
);
const promptMediumSchema: z.ZodType<PromptMediumWeights> = schemaFromChecker(
  (raw) => weightMapCheck(raw, PROMPT_MEDIUM_KEYS, []),
  (raw) => normalizeWeights(raw, PROMPT_MEDIUM_KEYS),
);
const freeformAnswerShapeSchema: z.ZodType<TriviaFreeformAnswerShapeWeights> = schemaFromChecker(
  (raw) => weightMapCheck(raw, FREEFORM_ANSWER_SHAPE_KEYS, []),
  (raw) => normalizeWeights(raw, FREEFORM_ANSWER_SHAPE_KEYS),
);
const difficultyBucketWeightsSchema: z.ZodType<DifficultyBucketWeights> = schemaFromChecker(
  (raw) => weightMapCheck(raw, DIFFICULTY_BUCKET_KEYS, []),
  (raw) => normalizeWeights(raw, DIFFICULTY_BUCKET_KEYS),
);

export function validateAnswersFormatMap(
  raw: unknown,
  fieldLabel: string,
): Result<TriviaAnswersFormatWeights> {
  return safeParseToResult(answersFormatSchema, raw, fieldLabel);
}
export function validateQuestionTypeMap(
  raw: unknown,
  fieldLabel: string,
): Result<TriviaQuestionTypeWeights> {
  return safeParseToResult(questionTypeSchema, raw, fieldLabel);
}
export function validatePromptMediumMap(
  raw: unknown,
  fieldLabel: string,
): Result<PromptMediumWeights> {
  return safeParseToResult(promptMediumSchema, raw, fieldLabel);
}
export function validateFreeformAnswerShapeMap(
  raw: unknown,
  fieldLabel: string,
): Result<TriviaFreeformAnswerShapeWeights> {
  return safeParseToResult(freeformAnswerShapeSchema, raw, fieldLabel);
}
export function validateDifficultyBucketWeights(
  raw: unknown,
  fieldLabel: string,
): Result<DifficultyBucketWeights> {
  return safeParseToResult(difficultyBucketWeightsSchema, raw, fieldLabel);
}

// --- Contexts --------------------------------------------------------------

const contextsSchema: z.ZodType<TriviaContextEntry[]> = schemaFromChecker(
  contextsCheck,
  normalizeContexts,
);

export function validateContextsList(
  raw: unknown,
  fieldLabel: string,
): Result<TriviaContextEntry[]> {
  return safeParseToResult(contextsSchema, raw, fieldLabel);
}

// --- Difficulty ranges -----------------------------------------------------

function normalizeRangesMap(raw: unknown): DifficultyRangesInput {
  const obj = isJsonObject(raw) ? raw : {};
  const out: DifficultyRangesInput = {};
  for (const bucket of DIFFICULTY_BUCKET_KEYS) {
    const value = obj[bucket];
    if (Array.isArray(value) && value.length === 2) {
      out[bucket] = [value[0] as number, value[1] as number];
    }
  }
  return out;
}

const difficultyRangesMapSchema: z.ZodType<DifficultyRangesInput> = schemaFromChecker(
  (raw) => rangesMapCheck(raw, [], DIFFICULTY_BUCKET_KEYS),
  normalizeRangesMap,
);

export function validateDifficultyRangesMap(
  raw: unknown,
  fieldLabel: string,
): Result<DifficultyRangesInput> {
  return safeParseToResult(difficultyRangesMapSchema, raw, fieldLabel);
}

function normalizeDifficultyPerFormat(raw: unknown): TriviaDifficultyConfig {
  const obj = isJsonObject(raw) ? raw : {};
  const out: TriviaDifficultyConfig = {};
  for (const fmt of DIFFICULTY_FORMAT_KEYS) {
    if (obj[fmt] === undefined) continue;
    out[fmt] = normalizeRangesMap(obj[fmt]);
  }
  return out;
}

const difficultyPerFormatSchema: z.ZodType<TriviaDifficultyConfig> = schemaFromChecker(
  (raw) =>
    perFormatCheck(raw, DIFFICULTY_FORMAT_KEYS, (value: JsonValue, prefix) =>
      rangesMapCheck(value, prefix, DIFFICULTY_BUCKET_KEYS),
    ),
  normalizeDifficultyPerFormat,
);

export function validateTriviaDifficultyMap(
  raw: unknown,
  fieldLabel: string,
): Result<TriviaDifficultyConfig> {
  return safeParseToResult(difficultyPerFormatSchema, raw, fieldLabel);
}

function normalizeRatioPerFormat(raw: unknown): TriviaDifficultyRatioConfig {
  const obj = isJsonObject(raw) ? raw : {};
  const out: TriviaDifficultyRatioConfig = {};
  for (const fmt of DIFFICULTY_FORMAT_KEYS) {
    if (obj[fmt] === undefined) continue;
    out[fmt] = normalizeWeights(obj[fmt], DIFFICULTY_BUCKET_KEYS);
  }
  return out;
}

const ratioPerFormatSchema: z.ZodType<TriviaDifficultyRatioConfig> = schemaFromChecker(
  (raw) =>
    perFormatCheck(raw, DIFFICULTY_FORMAT_KEYS, (value: JsonValue, prefix) =>
      weightMapCheck(value, DIFFICULTY_BUCKET_KEYS, prefix),
    ),
  normalizeRatioPerFormat,
);

export function validateTriviaDifficultyRatioMap(
  raw: unknown,
  fieldLabel: string,
): Result<TriviaDifficultyRatioConfig> {
  return safeParseToResult(ratioPerFormatSchema, raw, fieldLabel);
}

// --- Hint / enums / choices ------------------------------------------------

function normalizeHint(raw: unknown): TriviaHintConfig {
  const obj = isJsonObject(raw) ? raw : {};
  const out: TriviaHintConfig = { mode: obj.mode as HintMode };
  if (obj.minDifficulty !== undefined && obj.minDifficulty !== null) {
    out.minDifficulty = obj.minDifficulty as (typeof DIFFICULTY_BUCKET_KEYS)[number];
  }
  return out;
}

const hintSchema: z.ZodType<TriviaHintConfig> = schemaFromChecker(
  (raw) => hintCheck(raw, HINT_MODE_KEYS, DIFFICULTY_BUCKET_KEYS, HINT_ALLOWED_FIELDS),
  normalizeHint,
);

export function validateHintConfig(raw: unknown, fieldLabel: string): Result<TriviaHintConfig> {
  return safeParseToResult(hintSchema, raw, fieldLabel);
}

const allTimeRowSchema: z.ZodType<TriviaAllTimeRowMode> = schemaFromChecker(
  (raw) => enumCheck(raw, ALL_TIME_ROW_KEYS),
  (raw) => raw as TriviaAllTimeRowMode,
);

export function validateAllTimeRowMode(
  raw: unknown,
  fieldLabel: string,
): Result<TriviaAllTimeRowMode> {
  return safeParseToResult(allTimeRowSchema, raw, fieldLabel);
}

const includeRevealInQuestionsSchema: z.ZodType<TriviaIncludeRevealInQuestions> = schemaFromChecker(
  (raw) => enumCheck(raw, INCLUDE_REVEAL_IN_QUESTIONS_KEYS),
  (raw) => raw as TriviaIncludeRevealInQuestions,
);

export function validateIncludeRevealInQuestions(
  raw: unknown,
  fieldLabel: string,
): Result<TriviaIncludeRevealInQuestions> {
  return safeParseToResult(includeRevealInQuestionsSchema, raw, fieldLabel);
}

const finalRevealSummarySchema: z.ZodType<TriviaFinalRevealSummary> = schemaFromChecker(
  (raw) => enumCheck(raw, FINAL_REVEAL_SUMMARY_KEYS),
  (raw) => raw as TriviaFinalRevealSummary,
);

export function validateFinalRevealSummary(
  raw: unknown,
  fieldLabel: string,
): Result<TriviaFinalRevealSummary> {
  return safeParseToResult(finalRevealSummarySchema, raw, fieldLabel);
}

const tellMeMoreSchema: z.ZodType<TriviaTellMeMoreConfig> = z
  .object({ enabled: z.boolean() })
  .strict();

export function validateTellMeMore(
  raw: unknown,
  fieldLabel: string,
): Result<TriviaTellMeMoreConfig> {
  return safeParseToResult(tellMeMoreSchema, raw, fieldLabel);
}

const judgeLeniencySchema: z.ZodType<JudgeLeniency> = schemaFromChecker(
  (raw) => enumCheck(raw, JUDGE_LENIENCY_KEYS),
  (raw) => raw as JudgeLeniency,
);

export function validateJudgeLeniency(raw: unknown, fieldLabel: string): Result<JudgeLeniency> {
  return safeParseToResult(judgeLeniencySchema, raw, fieldLabel);
}

const choiceEmojiStyleSchema: z.ZodType<ChoiceEmojiStyle> = schemaFromChecker(
  (raw) => enumCheck(raw, CHOICE_EMOJI_STYLE_KEYS),
  (raw) => raw as ChoiceEmojiStyle,
);

export function validateChoiceEmojiStyle(
  raw: unknown,
  fieldLabel: string,
): Result<ChoiceEmojiStyle> {
  return safeParseToResult(choiceEmojiStyleSchema, raw, fieldLabel);
}

function normalizeChoices(raw: unknown): TriviaChoicesConfig {
  const obj = isJsonObject(raw) ? raw : {};
  const min = obj.min ?? DEFAULT_TRIVIA_CHOICES.min;
  const max = obj.max ?? DEFAULT_TRIVIA_CHOICES.max;
  return { min: min as number, max: max as number };
}

const choicesSchema: z.ZodType<TriviaChoicesConfig> = schemaFromChecker(
  (raw) => choicesCheck(raw, DEFAULT_TRIVIA_CHOICES),
  normalizeChoices,
);

export function validateTriviaChoicesConfig(
  raw: unknown,
  fieldLabel: string,
): Result<TriviaChoicesConfig> {
  return safeParseToResult(choicesSchema, raw, fieldLabel);
}

/**
 * The 5 cascading axes that every tier (workspace / game / season / slot) supports.
 * Each field is optional.
 */
export interface TriviaAxisBag {
  answersFormat?: TriviaAnswersFormatWeights;
  questionType?: TriviaQuestionTypeWeights;
  promptMedium?: PromptMediumWeights;
  freeformAnswerShape?: TriviaFreeformAnswerShapeWeights;
  contexts?: TriviaContextEntry[];
  difficulty?: TriviaDifficultyConfig;
  difficultyRatio?: TriviaDifficultyRatioConfig;
}

/**
 * Parse the axis bag with per-field validation. Returns successfully-parsed
 * axes AND any per-field issues. Callers decide whether to throw (strict,
 * management tools) or warn-and-drop (lenient, file loader). DRY for all four
 * cascade tiers. `fieldPrefix` is prepended to each axis label, e.g.
 * `"trivia.games[0]"` produces issues like `trivia.games[0].answersFormat`.
 */
export function parseTriviaAxisBag(
  raw: JsonObject,
  fieldPrefix: string,
): { axes: TriviaAxisBag; issues: ParseIssue[] } {
  const axes: TriviaAxisBag = {};
  const issues: ParseIssue[] = [];

  const apply = <T>(
    field: string,
    value: unknown,
    validator: (raw: unknown, label: string) => Result<T>,
    assign: (v: T) => void,
  ): void => {
    if (value === undefined) return;
    const label = `${fieldPrefix}.${field}`;
    const r = validator(value, label);
    if (r.ok) assign(r.value);
    else issues.push({ field: label, error: r.error });
  };

  apply("answersFormat", raw.answersFormat, validateAnswersFormatMap, (v) => {
    axes.answersFormat = v;
  });
  apply("questionType", raw.questionType, validateQuestionTypeMap, (v) => {
    axes.questionType = v;
  });
  apply("promptMedium", raw.promptMedium, validatePromptMediumMap, (v) => {
    axes.promptMedium = v;
  });
  apply("freeformAnswerShape", raw.freeformAnswerShape, validateFreeformAnswerShapeMap, (v) => {
    axes.freeformAnswerShape = v;
  });
  apply("contexts", raw.contexts, validateContextsList, (v) => {
    axes.contexts = v;
  });
  apply("difficulty", raw.difficulty, validateTriviaDifficultyMap, (v) => {
    axes.difficulty = v;
  });
  apply("difficultyRatio", raw.difficultyRatio, validateTriviaDifficultyRatioMap, (v) => {
    axes.difficultyRatio = v;
  });

  return { axes, issues };
}

// ---------------------------------------------------------------------------
// Shared zod schemas for tool input (axis bag). These are the STRUCTURAL arg
// schemas at the MCP tool boundary; the deeper semantics live in the `validate*`
// adapters above, which the tool handlers call after the SDK accepts the args.
// Key sets are pinned with `satisfies` against the same `*_KEYS` constants the
// validators use, so adding/removing a key in one place fails the compile until
// the other place is updated.
// ---------------------------------------------------------------------------

const integerWeight = z.number().int().nonnegative().optional();

type WeightShape<K extends string> = Record<K, typeof integerWeight>;

/** Shared zod schema for the `answersFormat` axis. */
export const answersFormatZod = z.object({
  boolean: integerWeight,
  choice: integerWeight,
  freeform: integerWeight,
} satisfies WeightShape<(typeof ANSWERS_FORMAT_KEYS)[number]>);

/** Shared zod schema for the `questionType` axis. */
export const questionTypeZod = z.object({
  fact: integerWeight,
  topical: integerWeight,
  prediction: integerWeight,
} satisfies WeightShape<(typeof QUESTION_TYPE_KEYS)[number]>);

/** Shared zod schema for the `promptMedium` axis. */
export const promptMediumZod = z.object({
  text: integerWeight,
  image: integerWeight,
} satisfies WeightShape<(typeof PROMPT_MEDIUM_KEYS)[number]>);

/** Shared zod schema for the `freeformAnswerShape` axis. */
export const freeformAnswerShapeZod = z.object({
  name: integerWeight,
  place: integerWeight,
  phrase: integerWeight,
  title: integerWeight,
  date: integerWeight,
  countable: integerWeight,
  other: integerWeight,
} satisfies WeightShape<(typeof FREEFORM_ANSWER_SHAPE_KEYS)[number]>);

/** Shared zod schema for the `contexts` axis (lens list). */
export const contextsZod = z.array(
  z.object({ name: z.string(), weight: z.number().positive().optional() }),
);

const difficultyRangeTuple = z.tuple([
  z.number().int().min(1).max(10),
  z.number().int().min(1).max(10),
]);

const difficultyRangesZod = z.object({
  easy: difficultyRangeTuple.optional(),
  medium: difficultyRangeTuple.optional(),
  hard: difficultyRangeTuple.optional(),
});

/** Shared zod schema for the per-format `difficulty` axis (1–10 range tuples). */
export const difficultyZod = z.object({
  boolean: difficultyRangesZod.optional(),
  choice: difficultyRangesZod.optional(),
  freeform: difficultyRangesZod.optional(),
});

/**
 * Shared zod schema for the bucket-weights inner shape. Tolerates missing keys
 * (they normalize to 0) and rejects all-zero maps via the refine check.
 */
export const bucketWeightsZod = z
  .object({
    easy: z.number().int().nonnegative().optional(),
    medium: z.number().int().nonnegative().optional(),
    hard: z.number().int().nonnegative().optional(),
  })
  .refine((m) => (m.easy ?? 0) > 0 || (m.medium ?? 0) > 0 || (m.hard ?? 0) > 0, {
    message: "at least one weight must be strictly positive",
  });

/**
 * Shared zod schema for the per-format `difficultyRatio` axis. Reused by every
 * management tool that accepts the axis.
 */
export const triviaDifficultyRatioZod = z.object({
  boolean: bucketWeightsZod.optional(),
  choice: bucketWeightsZod.optional(),
  freeform: bucketWeightsZod.optional(),
});

/** Shared zod schema for the `hint` axis (structural; semantics in `validateHintConfig`). */
export const triviaHintZod = z.object({
  mode: z.enum(HINT_MODE_KEYS as readonly [HintMode, ...HintMode[]]),
  minDifficulty: z.enum(DIFFICULTY_BUCKET_KEYS as readonly ["easy", "medium", "hard"]).optional(),
});

/** Shared zod schema for the `allTimeRow` axis (structural; semantics in `validateAllTimeRowMode`). */
export const triviaAllTimeRowZod = z.enum(
  ALL_TIME_ROW_KEYS as readonly [TriviaAllTimeRowMode, ...TriviaAllTimeRowMode[]],
);

/** Shared zod schema for the `includeRevealInQuestions` axis. */
export const triviaIncludeRevealInQuestionsZod = z.enum(
  INCLUDE_REVEAL_IN_QUESTIONS_KEYS as readonly [
    TriviaIncludeRevealInQuestions,
    ...TriviaIncludeRevealInQuestions[],
  ],
);

/** Shared zod schema for the `finalRevealSummary` axis. */
export const triviaFinalRevealSummaryZod = z.enum(
  FINAL_REVEAL_SUMMARY_KEYS as readonly [TriviaFinalRevealSummary, ...TriviaFinalRevealSummary[]],
);

/** Shared zod schema for the `tellMeMore` field (game+workspace; not a cascade axis). */
export const triviaTellMeMoreZod = z.object({ enabled: z.boolean() }).strict();

/** Shared zod schema for the `judgeLeniency` axis (structural; semantics in `validateJudgeLeniency`). */
export const triviaJudgeLeniencyZod = z.enum(
  JUDGE_LENIENCY_KEYS as readonly [JudgeLeniency, ...JudgeLeniency[]],
);

/** Shared zod schema for the `choiceEmojiStyle` axis (structural; semantics in `validateChoiceEmojiStyle`). */
export const triviaChoiceEmojiStyleZod = z.enum(
  CHOICE_EMOJI_STYLE_KEYS as readonly [ChoiceEmojiStyle, ...ChoiceEmojiStyle[]],
);

/** Shared zod schema for the `choices` axis (structural; `2 ≤ min ≤ max ≤ 4` in `validateTriviaChoicesConfig`). */
export const triviaChoicesZod = z.object({
  min: z.number().int(),
  max: z.number().int(),
});

/**
 * The axis zod schemas as a single map — handy for tools that splat them into
 * the input schema with `...axisFieldsZod` rather than naming each axis.
 */
export const axisFieldsZod = {
  answersFormat: answersFormatZod,
  questionType: questionTypeZod,
  promptMedium: promptMediumZod,
  freeformAnswerShape: freeformAnswerShapeZod,
  contexts: contextsZod,
  difficulty: difficultyZod,
  difficultyRatio: triviaDifficultyRatioZod,
} as const;
