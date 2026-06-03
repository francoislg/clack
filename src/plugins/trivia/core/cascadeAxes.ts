/**
 * Single source of truth for the trivia plugin's cascading axes.
 *
 * A field is a `CascadeAxes` member iff it resolves through the PER-QUESTION
 * cascade — i.e. it participates in the slot/season tiers, not merely
 * game+workspace. Every cascade tier type (`SeasonFormatSlot`, `SeasonEntry`,
 * `TriviaGame`, `TriviaConfig`) extends this interface, so every tier shares the
 * identical axis field set keyed by `keyof CascadeAxes`. That structural property
 * is what lets `resolveCascade` read any axis off any tier by key, and what makes
 * `AXIS_REGISTRY` compile-time exhaustive.
 *
 * Membership (13), per the rule above:
 *   - Uniform first-wins (10): answersFormat, questionType, promptMedium,
 *     freeformAnswerShape, contexts, hint, judgeLeniency, instructions,
 *     liveAnswersVisible, revealResponses. (The last two resolve at POST time,
 *     not generation time, but are 4-tier first-wins cascades all the same.)
 *   - Custom (3): difficulty (per-field merge), difficultyRatio (answersFormat-
 *     keyed), additionalInstructions (CUMULATIVE concat across tiers).
 *
 * Deliberately EXCLUDED (not per-question cascades): `format`, `categories`,
 * `theme` (structural-special), `allTimeRow` (game+workspace only), `choices`
 * (workspace-only). These keep their own resolvers and are audited via
 * `list_games` / `list_seasons`.
 *
 * Type-only imports keep this a leaf in the type graph: `configTypes.ts` and
 * `types.ts` import `CascadeAxes` back for their `extends` clauses, but because
 * every edge is `import type` there is no runtime cycle.
 */
import type {
  TriviaAnswersFormatWeights,
  TriviaQuestionTypeWeights,
  PromptMediumWeights,
  TriviaFreeformAnswerShapeWeights,
  TriviaContextEntry,
  TriviaDifficultyConfig,
  TriviaDifficultyRatioConfig,
  TriviaHintConfig,
  JudgeLeniency,
  RevealResponsesMode,
  SeasonFormatSlot,
  TriviaGame,
  TriviaConfig,
  DifficultyRanges,
  DifficultyBucketWeights,
} from "./configTypes.js";
import type { SeasonEntry, TriviaAnswersFormat } from "./types.js";

/** The cascading axes. See file header for membership rationale. */
export interface CascadeAxes {
  // --- Uniform first-wins (whole-value replace per tier) ---
  answersFormat?: TriviaAnswersFormatWeights;
  questionType?: TriviaQuestionTypeWeights;
  promptMedium?: PromptMediumWeights;
  freeformAnswerShape?: TriviaFreeformAnswerShapeWeights;
  contexts?: TriviaContextEntry[];
  hint?: TriviaHintConfig;
  judgeLeniency?: JudgeLeniency;
  instructions?: string;
  liveAnswersVisible?: boolean;
  revealResponses?: RevealResponsesMode;
  // --- Custom (bespoke resolver, still registry-enforced) ---
  difficulty?: TriviaDifficultyConfig;
  difficultyRatio?: TriviaDifficultyRatioConfig;
  additionalInstructions?: string;
}

/**
 * The tier a resolved value came from. `"merged"` is reported only by custom
 * axes (`difficulty` per-field merge, `additionalInstructions` cumulative concat)
 * when the result spans more than one tier.
 */
export type CascadeTier =
  | "seasonSlot"
  | "season"
  | "gameSlot"
  | "game"
  | "workspace"
  | "default"
  | "merged";

/** The five concrete tiers a value can be read from, in precedence order. */
export type ConcreteTier = "seasonSlot" | "season" | "gameSlot" | "game" | "workspace";
export const CASCADE_TIER_ORDER: readonly ConcreteTier[] = [
  "seasonSlot",
  "season",
  "gameSlot",
  "game",
  "workspace",
] as const;

/**
 * The resolution context: one object per tier, under the GAME-BASE / SEASON-OVERRIDE
 * model. The slot tier is split into two concrete tiers:
 *
 *   - `gameSlot` — the game format's slot (`game.format.questions[slotIndex]`), the
 *     authoritative per-question BASE.
 *   - `seasonSlot` — the season's per-slot OVERRIDE for the same index, which wins over
 *     the game slot. It is sourced (by `buildCascadeContext`) from `season.slotOverrides`
 *     or, when the season declares its own structural `format`, from that format's slot.
 *
 * Every tier object extends `CascadeAxes`, so the walker reads `ctx.seasonSlot?.[key]`,
 * `ctx.gameSlot?.[key]`, etc. Neither slot is re-derived from `season.format` inside a
 * resolver — `buildCascadeContext` is the single place that decides slot sourcing.
 *
 * `slotIndex` is carried for the `additionalInstructions` tier labels (`[Slot N]`).
 */
export interface CascadeContext {
  seasonSlot: SeasonFormatSlot | null;
  gameSlot: SeasonFormatSlot | null;
  slotIndex: number | null;
  season: SeasonEntry | null;
  game: TriviaGame | null;
  config: TriviaConfig | null;
}

/**
 * One rung of the audit ladder: a concrete tier and the RAW field value it supplied
 * (if any). Typed to the field type `F` (e.g. `TriviaDifficultyConfig` for difficulty),
 * which is what the tier literally holds — distinct from the resolved value type.
 */
export interface CascadeLadderEntry<F> {
  tier: ConcreteTier;
  value: F | undefined;
  /** Whether this tier supplied a value. */
  present: boolean;
  /** Whether this tier won the resolution (first-wins) or contributed to a merge. */
  winner: boolean;
}

/**
 * Resolution result for axis `K`: the resolved value, the winning tier (`"default"`
 * when nothing overrode, `"merged"` for a multi-tier custom merge), and the per-tier
 * ladder of raw field contributions (the four concrete tiers only).
 */
export interface CascadeResolution<K extends keyof CascadeAxes> {
  value: ResolvedAxisValue<K>;
  tier: CascadeTier;
  ladder: CascadeLadderEntry<CascadeAxes[K]>[];
}

/**
 * The RESOLVED value type per axis. Keyed directly off `keyof CascadeAxes`, so it
 * automatically covers exactly the axis set — a new member gets a resolved type for
 * free (the default branch); custom axes that resolve to something other than their
 * field type get an explicit branch:
 *   - `difficulty` / `difficultyRatio` are stored as per-answersFormat maps but resolve
 *     to a single format's slice (`DifficultyRanges` / `DifficultyBucketWeights`).
 *   - `contexts` / `instructions` / `additionalInstructions` resolve to `null` when no
 *     tier sets them.
 */
export type ResolvedAxisValue<K extends keyof CascadeAxes> = K extends "difficulty"
  ? DifficultyRanges
  : K extends "difficultyRatio"
    ? DifficultyBucketWeights
    : K extends "contexts" | "instructions" | "additionalInstructions"
      ? NonNullable<CascadeAxes[K]> | null
      : NonNullable<CascadeAxes[K]>;

/** Extra options for custom resolvers (difficulty/difficultyRatio key by answersFormat). */
export interface CustomResolveOpts {
  answersFormat?: TriviaAnswersFormat;
}

/**
 * A registry entry. `resolve` is the uniform resolution closure — first-wins axes get a
 * generic-walker closure, custom axes their bespoke resolver — and always returns a
 * `CascadeResolution<K>`, so the dispatcher needs no per-axis branching or casts. `kind`
 * is informational (surfaced by `explain_cascade`); `default` is the built-in fallback
 * for first-wins axes (custom axes compute their own, possibly per-answersFormat).
 */
export interface AxisDef<K extends keyof CascadeAxes> {
  kind: "first-wins" | "custom";
  default?: ResolvedAxisValue<K>;
  resolve: (ctx: CascadeContext, opts: CustomResolveOpts) => CascadeResolution<K>;
}

/**
 * The registry shape: exactly one `AxisDef` per `CascadeAxes` key. Because it is a
 * mapped type over `keyof CascadeAxes`, adding a member to `CascadeAxes` without a
 * registry entry — or vice versa — is a compile error. This is the sync lock.
 */
export type AxisRegistry = {
  [K in keyof CascadeAxes]: AxisDef<K>;
};
