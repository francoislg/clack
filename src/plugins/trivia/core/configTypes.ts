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
 * Reveal-time participation disclosure mode. Cascades slot → season → game →
 * workspace → `"yes"` default. Resolved at `post_questions` time and stamped
 * on the question record so mid-round config edits don't flip live behavior.
 *
 * - `"yes"` → full named voter buckets in the reveal payload; freeform Voters
 *   carry their `answerText`.
 * - `"just-correctness"` → named voter buckets, but freeform Voters DO NOT
 *   carry `answerText` (typed text stays anonymous).
 * - `"just-winners"` → names the `correct` voters only; incorrect and no-answer
 *   voters are reduced to anonymous counts (`incorrectCount` / `noAnswerCount`)
 *   so "N missed" / "everyone got fooled" flair survives without naming anyone.
 *   Freeform correct voters keep their `answerText`; missers are never quoted.
 * - `"no"` → reveal payload omits voter buckets entirely; only `reactions`
 *   commentary plus the leaderboard render.
 */
export type RevealResponsesMode = "no" | "just-winners" | "just-correctness" | "yes";

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
 * Weighted-random map for the orthogonal prompt-delivery medium axis. `text` questions
 * are delivered as text (today's behavior); `image` questions are delivered with an image
 * prompt sourced from an external `*_image_search__*` MCP tool. Defaults to
 * `{ text: 1, image: 0 }` (pre-visual behavior). Cascades slot → season → game →
 * workspace → default like the other weighted axes.
 */
export type PromptMediumWeights = Record<"text" | "image", number>;

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
 * Hint mode. `"none"` (the default) means no hint is generated and no hint UI
 * is rendered. `"button"` appends a "💡 Get Hint!" button to the question's
 * answer-button row; clicking posts an ephemeral message to the clicker.
 * `"inline"` prepends a `💡 _Hint:_ <text>` context block above the answer
 * buttons so every player sees it immediately. NOTE: `"button"` and `"inline"`
 * carry different game-design semantics — `"button"` is a per-player opt-in
 * safety net; `"inline"` is a room-wide difficulty floor adjustment.
 */
export type HintMode = "none" | "button" | "inline";

/**
 * Hint axis configuration. Cascades through slot → season → game → workspace →
 * `{ mode: "none" }` with **whole-object replace per tier** (matches the
 * `difficultyRatio` semantics). `minDifficulty`, when set, suppresses hint
 * generation for questions whose rolled difficulty bucket falls below the
 * threshold in the ordering `easy < medium < hard`. When unset, hints are
 * generated for every question whose effective mode is non-`"none"`.
 */
export interface TriviaHintConfig {
  mode: HintMode;
  /** When set, only generate a hint when the rolled difficulty bucket is at or above this value. */
  minDifficulty?: "easy" | "medium" | "hard";
}

/** Built-in fallback when no `hint` is set at any cascade tier. */
export const DEFAULT_HINT_CONFIG: TriviaHintConfig = { mode: "none" };

/**
 * "All Time" leaderboard-row visibility axis. Cascades `game → workspace →
 * "end-of-season-only"` (no season/slot tier). Governs the All-Time surface at
 * reveal time — the normal-reveal `All Time` row AND the season-finale All-Time
 * table (the surface additionally requires `hasPriorSeasons`):
 *   - `"always"` — render it on every reveal.
 *   - `"never"` — never render it.
 *   - `"end-of-season-only"` — render it only on the season's last fire
 *     (`SeasonStatusOut.isLastFireOfSeason`). The default.
 */
export type TriviaAllTimeRowMode = "always" | "never" | "end-of-season-only";

/** The three accepted `allTimeRow` values, for zod/validator reuse. */
export const ALL_TIME_ROW_KEYS = ["always", "never", "end-of-season-only"] as const;

/** Built-in fallback when no `allTimeRow` is set at any cascade tier. */
export const DEFAULT_ALL_TIME_ROW: TriviaAllTimeRowMode = "end-of-season-only";

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
  /**
   * Optional cron expression for the pre-staging run. When set, the plugin emits a
   * third channelless cron spec (`<name>:prep`) whose `requiredTools` excludes
   * `post_questions` — two structural defenses against the prep run delivering a
   * Slack message. Generation in the prep run writes saved questions with `postedAt`
   * undefined; the question cron's prompt later picks them up (oldest per slot) or
   * inline-generates anything missing. Cron arithmetic (e.g., "30 min before
   * questionCron") is intentionally done by Claude at `upsert_game` time, NOT by
   * the bot — see the trivia management admin instruction for derivation guidance.
   */
  prepCron?: string;
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
  /** Per-game tier of the prompt-medium axis. Cascade slot → season → game → workspace → default. */
  promptMedium?: PromptMediumWeights;
  freeformAnswerShape?: TriviaFreeformAnswerShapeWeights;
  contexts?: TriviaContextEntry[];
  difficulty?: TriviaDifficultyConfig;
  /**
   * Per-game tier of the bucket-roll ratio axis. Same cascade as the other weighted
   * axes (slot → season → game → workspace → built-in default). Whole-object replace
   * per tier; per-format keying (boolean / choice / freeform).
   */
  difficultyRatio?: TriviaDifficultyRatioConfig;
  /**
   * Optional per-game question composition (slot list). Cascade:
   *   `season.format → game.format → (single-question fallback)`.
   * Same shape as `SeasonEntry.format`; validated by the same `validateFormat`.
   * Absent at every tier → cron fire posts a single question (pre-format behavior).
   */
  format?: SeasonFormat;
  /**
   * Optional per-game category pool. Cascade:
   *   `slot.categories → season.categories → game.categories → categories.json`.
   * Must be a non-empty, deduped string list when present.
   */
  categories?: string[];
  /**
   * Optional per-game narrative theme. Cascade:
   *   `season.theme → game.theme → (no theme)`.
   * Trimmed, non-empty when present. Surfaced in opener / finale prompt copy.
   */
  theme?: string;
  /**
   * Optional per-game free-form guidance string with REPLACE cascade semantics.
   * Cascade: `slot.instructions → season.instructions → game.instructions →
   * workspace.instructions → null`. Surfaced to Claude via the `get_ideas`
   * and `process_reveal_answers` MCP tool response payloads — see the
   * `trivia-prompt-instructions` capability.
   */
  instructions?: string;
  /**
   * Optional per-game free-form guidance string with CUMULATIVE cascade
   * semantics. Every non-empty tier is concatenated in
   * `workspace → game → season → slot` order, each segment tier-labeled.
   * Surfaced to Claude via the `get_ideas` and `process_reveal_answers`
   * MCP tool response payloads — see the `trivia-prompt-instructions` capability.
   */
  additionalInstructions?: string;
  /**
   * Per-game tier of the live-roster-footer visibility axis. Cascade:
   *   `slot → season → game → workspace → true`.
   * When `true` (the cascaded default), the live "📝 Answered" footer reveals
   * each answerer's pick alongside their name. When `false`, the footer shows
   * names only.
   */
  liveAnswersVisible?: boolean;
  /**
   * Per-game tier of the reveal-time participation disclosure axis. Cascade:
   *   `slot → season → game → workspace → "yes"`.
   * Controls how much per-question participation detail surfaces in the
   * reveal message — see `RevealResponsesMode` for semantics.
   */
  revealResponses?: RevealResponsesMode;
  /**
   * Per-game tier of the hint axis. Cascade:
   *   `slot → season → game → workspace → { mode: "none" }`.
   * Whole-object replace per tier. See `TriviaHintConfig`.
   */
  hint?: TriviaHintConfig;
  /**
   * Per-game tier of the "All Time" leaderboard-row visibility axis. Cascade:
   *   `game → workspace → "end-of-season-only"`. See `TriviaAllTimeRowMode`.
   */
  allTimeRow?: TriviaAllTimeRowMode;
}

/**
 * One ordered slot in a season's or game's question format. Optional per-slot
 * overrides for every cascading axis — when absent, the slot inherits from the
 * season → game → workspace → built-in default cascade.
 */
export interface SeasonFormatSlot {
  label?: string;
  categories?: string[];
  answersFormat?: TriviaAnswersFormatWeights;
  questionType?: TriviaQuestionTypeWeights;
  /** Highest-precedence tier of the prompt-medium axis. */
  promptMedium?: PromptMediumWeights;
  freeformAnswerShape?: TriviaFreeformAnswerShapeWeights;
  contexts?: TriviaContextEntry[];
  difficulty?: TriviaDifficultyConfig;
  difficultyRatio?: TriviaDifficultyRatioConfig;
  /**
   * Highest-precedence tier of the replace-cascade `instructions` axis —
   * see the `trivia-prompt-instructions` capability.
   */
  instructions?: string;
  /**
   * Highest-precedence tier of the cumulative-cascade `additionalInstructions`
   * axis — see the `trivia-prompt-instructions` capability.
   */
  additionalInstructions?: string;
  /** Highest-precedence tier of the live-roster-footer visibility axis. */
  liveAnswersVisible?: boolean;
  /** Highest-precedence tier of the reveal-time disclosure axis. */
  revealResponses?: RevealResponsesMode;
  /** Highest-precedence tier of the hint axis. Whole-object replace per tier. */
  hint?: TriviaHintConfig;
}

/**
 * Question composition for one tier (season or game). When present, each
 * question-cron fire posts `questions.length` questions (one per slot, in array
 * order).
 */
export interface SeasonFormat {
  questions: SeasonFormatSlot[];
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
  /** Workspace default for the prompt-medium axis; overridable per-season / per-game / per-slot. */
  promptMedium?: PromptMediumWeights;
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
  /** Workspace default for the live-roster-footer visibility axis. */
  liveAnswersVisible?: boolean;
  /** Workspace default for the reveal-time disclosure axis. */
  revealResponses?: RevealResponsesMode;
  /**
   * Workspace tier of the hint axis. Cascade:
   *   `slot → season → game → workspace → { mode: "none" }`.
   * Whole-object replace per tier. See `TriviaHintConfig`.
   */
  hint?: TriviaHintConfig;
  /**
   * Workspace tier of the "All Time" leaderboard-row visibility axis. Cascade:
   *   `game → workspace → "end-of-season-only"`. See `TriviaAllTimeRowMode`.
   */
  allTimeRow?: TriviaAllTimeRowMode;
  /**
   * Workspace tier of the replace-cascade `instructions` axis — see the
   * `trivia-prompt-instructions` capability.
   */
  instructions?: string;
  /**
   * Workspace tier of the cumulative-cascade `additionalInstructions` axis —
   * see the `trivia-prompt-instructions` capability.
   */
  additionalInstructions?: string;
}

/** Defaults applied when `choices` is absent or only partially specified. */
export const DEFAULT_TRIVIA_CHOICES: TriviaChoicesConfig = { min: 4, max: 4 };

/** Built-in fallback when no `questionType` weights are set at any cascade tier. */
export const DEFAULT_QUESTION_TYPE_WEIGHTS: TriviaQuestionTypeWeights = { fact: 1, topical: 0 };

/** Built-in fallback when no `promptMedium` weights are set at any cascade tier. */
export const DEFAULT_PROMPT_MEDIUM_WEIGHTS: PromptMediumWeights = { text: 1, image: 0 };

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
