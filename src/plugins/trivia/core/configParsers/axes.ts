/**
 * Pure validators + shared axis-bag parser for the 5 cascading axes
 * (answersFormat, questionType, freeformAnswerShape, contexts, difficulty).
 * Used by every tier: workspace (file loader), game (parseTriviaGame),
 * season (upsert_season), slot (upsert_season's slot validation).
 */

import { z } from "zod";
import type {
  DifficultyBucketWeights,
  DifficultyRange,
  DifficultyRangesInput,
  HintMode,
  JsonObject,
  RevealResponsesMode,
  TriviaAnswersFormatWeights,
  TriviaChoicesConfig,
  TriviaContextEntry,
  TriviaDifficultyConfig,
  TriviaDifficultyRatioConfig,
  TriviaFreeformAnswerShapeWeights,
  TriviaHintConfig,
  TriviaQuestionTypeWeights,
} from "../configTypes.js";
import { DEFAULT_TRIVIA_CHOICES } from "../configTypes.js";

/** Tagged result so callers can decide how to react (throw / warn-and-drop / skip). */
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/** One issue surfaced while parsing. `field` is a dot-joined path like `trivia.games[0].answersFormat`. */
export interface ParseIssue {
  field: string;
  error: string;
}

export const ANSWERS_FORMAT_KEYS = ["boolean", "choice", "freeform"] as const;
export const QUESTION_TYPE_KEYS = ["fact", "topical"] as const;
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
const DIFFICULTY_RATIO_FORMAT_KEYS = ["boolean", "choice", "freeform"] as const;
export const HINT_MODE_KEYS = ["none", "button", "inline"] as const;
const HINT_ALLOWED_FIELDS = new Set(["mode", "minDifficulty"]);

/** The literal string set for `revealResponses` — shared across tiers. */
export const REVEAL_RESPONSES_VALUES = ["no", "just-winners", "just-correctness", "yes"] as const;

/**
 * Type guard for `revealResponses`. Lenient — callers decide how to react
 * (drop-with-warning at config parse, throw at upsert tools).
 */
export function isRevealResponsesMode(raw: unknown): raw is RevealResponsesMode {
  return typeof raw === "string" && (REVEAL_RESPONSES_VALUES as readonly string[]).includes(raw);
}

export function validateAnswersFormatMap(
  raw: unknown,
  fieldLabel: string,
): Result<TriviaAnswersFormatWeights> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: `'${fieldLabel}' must be an object` };
  }
  const out: Partial<TriviaAnswersFormatWeights> = {};
  let positiveCount = 0;
  for (const [key, value] of Object.entries(raw)) {
    if (!(ANSWERS_FORMAT_KEYS as readonly string[]).includes(key)) {
      return {
        ok: false,
        error: `'${fieldLabel}' contains unknown key '${key}' (allowed: ${ANSWERS_FORMAT_KEYS.join(", ")})`,
      };
    }
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      !Number.isInteger(value) ||
      value < 0
    ) {
      return {
        ok: false,
        error: `'${fieldLabel}.${key}' must be a non-negative integer (got ${JSON.stringify(value)})`,
      };
    }
    out[key as (typeof ANSWERS_FORMAT_KEYS)[number]] = value;
    if (value > 0) positiveCount++;
  }
  if (positiveCount === 0) {
    return { ok: false, error: `'${fieldLabel}' must have at least one strictly positive weight` };
  }
  return {
    ok: true,
    value: { boolean: out.boolean ?? 0, choice: out.choice ?? 0, freeform: out.freeform ?? 0 },
  };
}

export function validateQuestionTypeMap(
  raw: unknown,
  fieldLabel: string,
): Result<TriviaQuestionTypeWeights> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: `'${fieldLabel}' must be an object` };
  }
  const out: Partial<TriviaQuestionTypeWeights> = {};
  let positiveCount = 0;
  for (const [key, value] of Object.entries(raw)) {
    if (!(QUESTION_TYPE_KEYS as readonly string[]).includes(key)) {
      return {
        ok: false,
        error: `'${fieldLabel}' contains unknown key '${key}' (allowed: ${QUESTION_TYPE_KEYS.join(", ")})`,
      };
    }
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      !Number.isInteger(value) ||
      value < 0
    ) {
      return {
        ok: false,
        error: `'${fieldLabel}.${key}' must be a non-negative integer (got ${JSON.stringify(value)})`,
      };
    }
    out[key as (typeof QUESTION_TYPE_KEYS)[number]] = value;
    if (value > 0) positiveCount++;
  }
  if (positiveCount === 0) {
    return { ok: false, error: `'${fieldLabel}' must have at least one strictly positive weight` };
  }
  return { ok: true, value: { fact: out.fact ?? 0, topical: out.topical ?? 0 } };
}

export function validateFreeformAnswerShapeMap(
  raw: unknown,
  fieldLabel: string,
): Result<TriviaFreeformAnswerShapeWeights> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: `'${fieldLabel}' must be an object` };
  }
  const out: Partial<TriviaFreeformAnswerShapeWeights> = {};
  let positiveCount = 0;
  for (const [key, value] of Object.entries(raw)) {
    if (!(FREEFORM_ANSWER_SHAPE_KEYS as readonly string[]).includes(key)) {
      return {
        ok: false,
        error: `'${fieldLabel}' contains unknown key '${key}' (allowed: ${FREEFORM_ANSWER_SHAPE_KEYS.join(", ")})`,
      };
    }
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      !Number.isInteger(value) ||
      value < 0
    ) {
      return {
        ok: false,
        error: `'${fieldLabel}.${key}' must be a non-negative integer (got ${JSON.stringify(value)})`,
      };
    }
    out[key as (typeof FREEFORM_ANSWER_SHAPE_KEYS)[number]] = value;
    if (value > 0) positiveCount++;
  }
  if (positiveCount === 0) {
    return { ok: false, error: `'${fieldLabel}' must have at least one strictly positive weight` };
  }
  return {
    ok: true,
    value: {
      name: out.name ?? 0,
      place: out.place ?? 0,
      phrase: out.phrase ?? 0,
      title: out.title ?? 0,
      date: out.date ?? 0,
      countable: out.countable ?? 0,
      other: out.other ?? 0,
    },
  };
}

export function validateContextsList(
  raw: unknown,
  fieldLabel: string,
): Result<TriviaContextEntry[]> {
  if (!Array.isArray(raw)) {
    return { ok: false, error: `'${fieldLabel}' must be an array` };
  }
  if (raw.length === 0) {
    return { ok: false, error: `'${fieldLabel}' must be non-empty when present` };
  }
  const out: TriviaContextEntry[] = [];
  const seenNames = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const entry: unknown = raw[i];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return { ok: false, error: `'${fieldLabel}[${i}]' must be an object` };
    }
    const e = entry as { name?: unknown; weight?: unknown };
    if (typeof e.name !== "string") {
      return { ok: false, error: `'${fieldLabel}[${i}].name' must be a string` };
    }
    if (seenNames.has(e.name)) {
      return { ok: false, error: `'${fieldLabel}[${i}]' has duplicate name '${e.name}'` };
    }
    seenNames.add(e.name);
    let weight: number | undefined;
    if (e.weight !== undefined) {
      if (typeof e.weight !== "number" || !Number.isFinite(e.weight) || e.weight <= 0) {
        return {
          ok: false,
          error: `'${fieldLabel}[${i}].weight' must be a positive number (got ${JSON.stringify(e.weight)})`,
        };
      }
      weight = e.weight;
    }
    out.push(weight === undefined ? { name: e.name } : { name: e.name, weight });
  }
  return { ok: true, value: out };
}

function validateDifficultyRange(raw: unknown, fieldLabel: string): Result<DifficultyRange> {
  if (!Array.isArray(raw) || raw.length !== 2) {
    return { ok: false, error: `'${fieldLabel}' must be a [min, max] tuple` };
  }
  const [min, max] = raw;
  if (typeof min !== "number" || !Number.isInteger(min) || min < 1 || min > 10) {
    return {
      ok: false,
      error: `'${fieldLabel}[0]' must be an integer in [1, 10] (got ${JSON.stringify(min)})`,
    };
  }
  if (typeof max !== "number" || !Number.isInteger(max) || max < 1 || max > 10) {
    return {
      ok: false,
      error: `'${fieldLabel}[1]' must be an integer in [1, 10] (got ${JSON.stringify(max)})`,
    };
  }
  if (min > max) {
    return { ok: false, error: `'${fieldLabel}' min (${min}) must be <= max (${max})` };
  }
  return { ok: true, value: [min, max] };
}

export function validateDifficultyRangesMap(
  raw: unknown,
  fieldLabel: string,
): Result<DifficultyRangesInput> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: `'${fieldLabel}' must be an object` };
  }
  const entries = raw as JsonObject;
  const out: DifficultyRangesInput = {};
  for (const key of Object.keys(entries)) {
    if (!(DIFFICULTY_BUCKET_KEYS as readonly string[]).includes(key)) {
      return {
        ok: false,
        error: `'${fieldLabel}' contains unknown key '${key}' (allowed: easy, medium, hard)`,
      };
    }
  }
  for (const bucket of DIFFICULTY_BUCKET_KEYS) {
    if (entries[bucket] === undefined) continue;
    const r = validateDifficultyRange(entries[bucket], `${fieldLabel}.${bucket}`);
    if (!r.ok) return r;
    out[bucket] = r.value;
  }
  return { ok: true, value: out };
}

export function validateDifficultyBucketWeights(
  raw: unknown,
  fieldLabel: string,
): Result<DifficultyBucketWeights> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: `'${fieldLabel}' must be an object` };
  }
  const out: Partial<DifficultyBucketWeights> = {};
  let positiveCount = 0;
  for (const [key, value] of Object.entries(raw)) {
    if (!(DIFFICULTY_BUCKET_KEYS as readonly string[]).includes(key)) {
      return {
        ok: false,
        error: `'${fieldLabel}' contains unknown key '${key}' (allowed: ${DIFFICULTY_BUCKET_KEYS.join(", ")})`,
      };
    }
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      !Number.isInteger(value) ||
      value < 0
    ) {
      return {
        ok: false,
        error: `'${fieldLabel}.${key}' must be a non-negative integer (got ${JSON.stringify(value)})`,
      };
    }
    out[key as (typeof DIFFICULTY_BUCKET_KEYS)[number]] = value;
    if (value > 0) positiveCount++;
  }
  if (positiveCount === 0) {
    return { ok: false, error: `'${fieldLabel}' must have at least one strictly positive weight` };
  }
  return {
    ok: true,
    value: { easy: out.easy ?? 0, medium: out.medium ?? 0, hard: out.hard ?? 0 },
  };
}

export function validateTriviaDifficultyRatioMap(
  raw: unknown,
  fieldLabel: string,
): Result<TriviaDifficultyRatioConfig> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: `'${fieldLabel}' must be an object` };
  }
  const entries = raw as JsonObject;
  const out: TriviaDifficultyRatioConfig = {};
  for (const key of Object.keys(entries)) {
    if (!(DIFFICULTY_RATIO_FORMAT_KEYS as readonly string[]).includes(key)) {
      return {
        ok: false,
        error: `'${fieldLabel}' contains unknown key '${key}' (allowed: ${DIFFICULTY_RATIO_FORMAT_KEYS.join(", ")})`,
      };
    }
  }
  for (const fmt of DIFFICULTY_RATIO_FORMAT_KEYS) {
    if (entries[fmt] === undefined) continue;
    const r = validateDifficultyBucketWeights(entries[fmt], `${fieldLabel}.${fmt}`);
    if (!r.ok) return r;
    out[fmt] = r.value;
  }
  return { ok: true, value: out };
}

export function validateHintConfig(raw: unknown, fieldLabel: string): Result<TriviaHintConfig> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: `'${fieldLabel}' must be an object` };
  }
  const entries = raw as JsonObject;
  for (const key of Object.keys(entries)) {
    if (!HINT_ALLOWED_FIELDS.has(key)) {
      return {
        ok: false,
        error: `'${fieldLabel}' contains unknown key '${key}' (allowed: mode, minDifficulty)`,
      };
    }
  }
  const mode = entries.mode;
  if (typeof mode !== "string" || !(HINT_MODE_KEYS as readonly string[]).includes(mode)) {
    return {
      ok: false,
      error: `'${fieldLabel}.mode' must be one of ${HINT_MODE_KEYS.join(", ")} (got ${JSON.stringify(mode)})`,
    };
  }
  const out: TriviaHintConfig = { mode: mode as HintMode };
  if (entries.minDifficulty !== undefined && entries.minDifficulty !== null) {
    const min = entries.minDifficulty;
    if (typeof min !== "string" || !(DIFFICULTY_BUCKET_KEYS as readonly string[]).includes(min)) {
      return {
        ok: false,
        error: `'${fieldLabel}.minDifficulty' must be one of ${DIFFICULTY_BUCKET_KEYS.join(", ")} (got ${JSON.stringify(min)})`,
      };
    }
    out.minDifficulty = min as (typeof DIFFICULTY_BUCKET_KEYS)[number];
  }
  return { ok: true, value: out };
}

export function validateTriviaDifficultyMap(
  raw: unknown,
  fieldLabel: string,
): Result<TriviaDifficultyConfig> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: `'${fieldLabel}' must be an object` };
  }
  const entries = raw as JsonObject;
  const out: TriviaDifficultyConfig = {};
  for (const key of Object.keys(entries)) {
    if (!(DIFFICULTY_FORMAT_KEYS as readonly string[]).includes(key)) {
      return {
        ok: false,
        error: `'${fieldLabel}' contains unknown key '${key}' (allowed: ${DIFFICULTY_FORMAT_KEYS.join(", ")})`,
      };
    }
  }
  for (const fmt of DIFFICULTY_FORMAT_KEYS) {
    if (entries[fmt] === undefined) continue;
    const r = validateDifficultyRangesMap(entries[fmt], `${fieldLabel}.${fmt}`);
    if (!r.ok) return r;
    out[fmt] = r.value;
  }
  return { ok: true, value: out };
}

export function validateTriviaChoicesConfig(
  raw: unknown,
  fieldLabel: string,
): Result<TriviaChoicesConfig> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: `'${fieldLabel}' must be an object` };
  }
  const entries = raw as JsonObject;
  const min = entries.min ?? DEFAULT_TRIVIA_CHOICES.min;
  const max = entries.max ?? DEFAULT_TRIVIA_CHOICES.max;
  if (typeof min !== "number" || !Number.isInteger(min) || min < 2 || min > 4) {
    return {
      ok: false,
      error: `'${fieldLabel}.min' must be an integer in [2, 4] (got ${JSON.stringify(min)})`,
    };
  }
  if (typeof max !== "number" || !Number.isInteger(max) || max < 2 || max > 4) {
    return {
      ok: false,
      error: `'${fieldLabel}.max' must be an integer in [2, 4] (got ${JSON.stringify(max)})`,
    };
  }
  if (min > max) {
    return { ok: false, error: `'${fieldLabel}' min (${min}) must be <= max (${max})` };
  }
  return { ok: true, value: { min, max } };
}

/**
 * The 5 cascading axes that every tier (workspace / game / season / slot) supports.
 * Each field is optional.
 */
export interface TriviaAxisBag {
  answersFormat?: TriviaAnswersFormatWeights;
  questionType?: TriviaQuestionTypeWeights;
  freeformAnswerShape?: TriviaFreeformAnswerShapeWeights;
  contexts?: TriviaContextEntry[];
  difficulty?: TriviaDifficultyConfig;
  difficultyRatio?: TriviaDifficultyRatioConfig;
}

/**
 * Parse the 5-axis bag with per-field validation. Returns successfully-parsed
 * axes AND any per-field issues. Callers decide whether to throw (strict,
 * management tools) or warn-and-drop (lenient, file loader). DRY for all four
 * cascade tiers.
 *
 * `fieldPrefix` is prepended to each axis label, e.g. `"trivia.games[0]"`
 * produces issues like `trivia.games[0].answersFormat`.
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
// Shared zod schemas for tool input (axis bag).
//
// These shape-check JSON-from-Claude into the same key sets the validators
// above accept. They DELIBERATELY don't enforce semantic rules (e.g. "at least
// one positive weight") — every management tool feeds the result through the
// validators / `parseTriviaAxisBag`, which own those checks. Keeping the zod
// schemas thin means the two layers can never drift on the semantic rules:
// there's exactly one place each rule is enforced.
//
// Key sets are pinned with `satisfies` against the same `*_KEYS` constants the
// validators use, so adding/removing a key in one place fails the compile
// until the other place is updated.
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
} satisfies WeightShape<(typeof QUESTION_TYPE_KEYS)[number]>);

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
 * management tool that accepts the axis (`setWorkspaceConfig`, `upsertGame`,
 * `upsertSeason`, and the slot-tier inside `upsertSeason`).
 */
export const triviaDifficultyRatioZod = z.object({
  boolean: bucketWeightsZod.optional(),
  choice: bucketWeightsZod.optional(),
  freeform: bucketWeightsZod.optional(),
});

/**
 * Shared zod schema for the `hint` axis. Thin shape-check — semantic validation
 * (allowed `mode` / `minDifficulty` values, unknown-key rejection) lives in
 * `validateHintConfig`. Every management tool that accepts the axis funnels
 * through that validator so the two layers can't drift.
 */
export const triviaHintZod = z.object({
  mode: z.enum(HINT_MODE_KEYS as readonly [HintMode, ...HintMode[]]),
  minDifficulty: z.enum(DIFFICULTY_BUCKET_KEYS as readonly ["easy", "medium", "hard"]).optional(),
});

/**
 * The 6 zod schemas as a single map — handy for tools that splat them into
 * the input schema with `...axisFieldsZod` rather than naming each axis.
 * Each is `.nullable().optional()`-ready (callers can chain `.nullable().optional()`
 * + `.describe(...)` to apply the standard "omit-to-keep / null-to-clear"
 * semantics that every management tool uses).
 */
export const axisFieldsZod = {
  answersFormat: answersFormatZod,
  questionType: questionTypeZod,
  freeformAnswerShape: freeformAnswerShapeZod,
  contexts: contextsZod,
  difficulty: difficultyZod,
  difficultyRatio: triviaDifficultyRatioZod,
} as const;
