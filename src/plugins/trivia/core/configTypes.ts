/**
 * Plugin-owned types for the trivia plugin's configuration. Per the plugin
 * hard rules (see src/plugins/CLAUDE.md), these types MUST NOT be imported
 * from src/config.ts — that file is bot-core and outside the SDK boundary.
 * The plugin owns its own type definitions.
 */

/** Feature flag + author prompt for the trivia seasons mechanism. */
export interface TriviaSeasonsConfig {
  enabled: boolean;
  prompt: string;
}

/**
 * Weighted-random map of answer format → weight. Weights are non-negative integers;
 * at least one weight MUST be strictly positive. `get_ideas` re-normalizes at roll time.
 *
 * All keys are required in the normalized in-memory shape — `0` means "never roll
 * this format". Validators accept config input where any key is omitted (defaults to 0).
 */
export interface TriviaAnswersFormatWeights {
  boolean: number;
  choice: number;
  freeform: number;
}

/**
 * Weighted-random map for the orthogonal fact-vs-topical axis. `fact` questions draw
 * from static knowledge; `topical` questions invoke `WebSearch` to find a recent
 * newsworthy event. Defaults to `{ fact: 1, topical: 0 }` (pre-topical behavior).
 */
export type TriviaQuestionTypeWeights = Record<"fact" | "topical", number>;

/**
 * The shape Claude should aim for when writing a freeform-answer question. Rolled
 * by `get_ideas` on the freeform branch only — boolean/choice questions ignore it.
 */
export type TriviaFreeformAnswerShape =
  | "name"
  | "place"
  | "phrase"
  | "title"
  | "date"
  | "countable"
  | "other";

export type TriviaFreeformAnswerShapeWeights = Record<TriviaFreeformAnswerShape, number>;

/**
 * One entry in the optional `contexts` axis. `name` is the lens label (any string,
 * including the empty string which means "no specific lean"). `weight` defaults to 1.
 */
export interface TriviaContextEntry {
  name: string;
  weight?: number;
}

/**
 * Bounds for the number of options in a `choice` question. Both bounds must satisfy
 * `2 <= min <= max <= 4`. Workspace-only — not season-overridable.
 */
export interface TriviaChoicesConfig {
  min: number;
  max: number;
}

/**
 * Inclusive integer range on the 1–10 difficulty self-rating scale. Tuple `[min, max]`
 * with `1 <= min <= max <= 10`.
 */
export type DifficultyRange = [number, number];

/**
 * Per-bucket target difficulty ranges for one answers-format game type
 * (boolean / choice / freeform). All fields required in the fully-resolved shape.
 * Each bucket's `[min, max]` IS the strict accept bound — there is no separate
 * reject-below threshold (replaced by the `difficultyRatio` axis as of the
 * `add-trivia-difficulty-ratio` change).
 */
export interface DifficultyRanges {
  easy: DifficultyRange;
  medium: DifficultyRange;
  hard: DifficultyRange;
}

/** Sparse input shape used at config / season / slot tiers. Every field optional. */
export type DifficultyRangesInput = Partial<DifficultyRanges>;

/**
 * Per-answers-format difficulty config. Each format (boolean / choice / freeform) is
 * independently configurable; freeform defaults to softer ranges since typing an answer
 * is intrinsically harder than picking from a list.
 */
export type TriviaDifficultyConfig = Partial<
  Record<"boolean" | "choice" | "freeform", DifficultyRangesInput>
>;

/**
 * Weighted-random map of difficulty bucket → weight. Drives which bucket
 * (`easy` / `medium` / `hard`) `get_ideas` rolls for each question. Weights are
 * non-negative integers; missing keys normalize to `0`. At least one weight MUST
 * be strictly positive.
 */
export type DifficultyBucketWeights = Record<"easy" | "medium" | "hard", number>;

/**
 * Per-answers-format difficulty-bucket ratio. Each format key carries its own
 * `{ easy, medium, hard }` weight map. Cascades through slot → season → game →
 * workspace → built-in default with **whole-object replace per tier** (no per-field
 * merge; matches `answersFormat` / `questionType` semantics). Distinct axis from
 * `difficulty` (the ranges), which uses per-field merge.
 */
export type TriviaDifficultyRatioConfig = Partial<
  Record<"boolean" | "choice" | "freeform", DifficultyBucketWeights>
>;

/**
 * One trivia game declared in plugin config. The trivia plugin reconciles its cron jobs
 * from this list on every load: each entry produces two plugin-managed cron jobs
 * (`<name>:question` and `<name>:reveal`).
 */
export interface TriviaGame {
  /** Unique identifier within `games[]`; used in `specKey`. Must match `^[a-z0-9-]+$`, length 1–32. */
  name: string;
  /** Slack channel ID where this game runs (e.g. `C123ABC`). */
  channel: string;
  /** Cron expression for when the daily question is posted. */
  questionCron: string;
  /** Cron expression for when the answer is revealed. */
  revealCron: string;
  /** IANA timezone the cron expressions are interpreted in. */
  timezone: string;
  /** When `false`, the plugin skips this entry during cron reconcile AND per-game write tools refuse. Defaults to `true`. */
  enabled?: boolean;
  /**
   * Optional per-game tier on the cascading axis configuration. Each field uses the
   * EXACT same shape as the corresponding workspace-tier field on `TriviaConfig` and
   * sits between season and workspace in the cascade
   * (slot → season → game → workspace → built-in default). When absent, the game
   * tier is skipped and the cascade falls through directly from season to workspace.
   */
  answersFormat?: TriviaAnswersFormatWeights;
  questionType?: TriviaQuestionTypeWeights;
  freeformAnswerShape?: TriviaFreeformAnswerShapeWeights;
  contexts?: TriviaContextEntry[];
  difficulty?: TriviaDifficultyConfig;
  /**
   * Per-game tier of the bucket-roll ratio axis. Same cascade as the other weighted
   * axes (slot → season → game → workspace → built-in default). Whole-object replace
   * per tier; per-format keying (boolean / choice / freeform).
   */
  difficultyRatio?: TriviaDifficultyRatioConfig;
}

/**
 * One off-day for the trivia plugin. Propagated into every cron job's `skipDates` field
 * at reconcile time. Shared across all games — no per-game override.
 */
export interface OffDay {
  /** `YYYY-MM-DD` for an exact date, or `MM-DD` for a date that recurs annually. */
  date: string;
  /** Human-readable label used in logs and Home Tab display. Required, non-empty. */
  label: string;
}

/**
 * Top-level shape of `data/plugins/trivia/config.json`. The file's JSON root IS this
 * object (no `trivia` wrapper key).
 */
export interface TriviaConfig {
  seasons?: TriviaSeasonsConfig;
  /** Workspace default; overridable per-season via SeasonEntry.answersFormat and per-game via TriviaGame.answersFormat. */
  answersFormat?: TriviaAnswersFormatWeights;
  /** Workspace default; overridable per-season / per-game / per-slot. */
  questionType?: TriviaQuestionTypeWeights;
  /** Workspace default; freeform-branch only. */
  freeformAnswerShape?: TriviaFreeformAnswerShapeWeights;
  /** Optional lens axis. */
  contexts?: TriviaContextEntry[];
  /** Bounds for choice-question option counts. */
  choices?: TriviaChoicesConfig;
  /** Per-game-type difficulty ranges. */
  difficulty?: TriviaDifficultyConfig;
  /**
   * Per-game-type bucket-roll ratio. Independent from `difficulty` (which sets the
   * 1–10 range per bucket); this controls how often each bucket is rolled. Same
   * cascade as the other weighted axes; whole-object replace per tier.
   */
  difficultyRatio?: TriviaDifficultyRatioConfig;
  /** Declarative trivia games. */
  games?: TriviaGame[];
  /** Plugin-level off-days, shared by every entry in `games[]`. */
  offDays?: OffDay[];
}

/** Defaults applied when `choices` is absent or only partially specified. */
export const DEFAULT_TRIVIA_CHOICES: TriviaChoicesConfig = { min: 4, max: 4 };

/** Built-in fallback when no `questionType` weights are set at any cascade tier. */
export const DEFAULT_QUESTION_TYPE_WEIGHTS: TriviaQuestionTypeWeights = { fact: 1, topical: 0 };

/** Built-in fallback when no `freeformAnswerShape` weights are set at any cascade tier. */
export const DEFAULT_FREEFORM_ANSWER_SHAPE_WEIGHTS: TriviaFreeformAnswerShapeWeights = {
  name: 1,
  place: 1,
  phrase: 1,
  title: 1,
  date: 1,
  countable: 1,
  other: 1,
};

/**
 * Built-in fallback difficulty ranges per answers-format. Freeform is shifted -2 across
 * every bucket to keep difficulty perception roughly equal across formats.
 */
export const DEFAULT_DIFFICULTY_RANGES: Record<
  "boolean" | "choice" | "freeform",
  DifficultyRanges
> = {
  boolean: { easy: [4, 6], medium: [7, 8], hard: [9, 10] },
  choice: { easy: [4, 6], medium: [7, 8], hard: [9, 10] },
  freeform: { easy: [2, 4], medium: [5, 6], hard: [7, 8] },
};

/**
 * Built-in fallback bucket-roll ratio per answers-format. Boolean/choice preserve the
 * historical effective 30/60/10 distribution (`pickSuggestedDifficulty`'s hardcoded
 * weights). Freeform skews easier because typing an answer is intrinsically harder
 * than picking from a list — same reasoning that shifts `DEFAULT_DIFFICULTY_RANGES.freeform`
 * down by 2 across every bucket.
 */
export const DEFAULT_DIFFICULTY_RATIO: Record<
  "boolean" | "choice" | "freeform",
  DifficultyBucketWeights
> = {
  boolean: { easy: 3, medium: 6, hard: 1 },
  choice: { easy: 3, medium: 6, hard: 1 },
  freeform: { easy: 5, medium: 4, hard: 1 },
};

/** JSON value tree used as validator input. Plugin-local so we don't import from bot core. */
export type JsonPrimitive = string | number | boolean | null;
export type JsonArray = JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}
export type JsonValue = JsonPrimitive | JsonArray | JsonObject;
