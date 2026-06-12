/**
 * The single resolution path for every cascading axis, plus the compile-time-exhaustive
 * `AXIS_REGISTRY` that drives it.
 *
 * `resolveCascade(key, ctx, opts?)` returns the resolved value, the winning tier, and the
 * full per-tier ladder. Both production consumers — `get_ideas` (generation axes) and
 * `post_questions` (`liveAnswersVisible`/`revealResponses`) — call this, and so does the
 * `explain_cascade` audit tool, so value and provenance can never disagree.
 *
 * - Uniform first-wins axes (10) are walked generically by key: slot → season → game →
 *   workspace → built-in default.
 * - Custom axes (3) delegate to their existing resolvers for the VALUE (byte-identical to
 *   pre-refactor behavior) and compute provenance for the ladder:
 *     - `difficulty` — per-field merge, answersFormat-keyed; reports `"merged"` when fields span tiers.
 *     - `difficultyRatio` — answersFormat-keyed first-wins.
 *     - `additionalInstructions` — cumulative concat across tiers; reports `"merged"`.
 */
import { DEFAULT_ANSWERS_FORMAT_WEIGHTS } from "./questionTypes.js";
import {
  DEFAULT_QUESTION_TYPE_WEIGHTS,
  DEFAULT_PROMPT_MEDIUM_WEIGHTS,
  DEFAULT_FREEFORM_ANSWER_SHAPE_WEIGHTS,
  DEFAULT_HINT_CONFIG,
  DEFAULT_JUDGE_LENIENCY,
  DEFAULT_TRIVIA_CHOICES,
  DEFAULT_CHOICE_EMOJI_STYLE,
} from "../core/configTypes.js";
import type {
  AxisDef,
  AxisRegistry,
  CascadeAxes,
  CascadeContext,
  CascadeLadderEntry,
  CascadeResolution,
  CascadeTier,
  ConcreteTier,
  CustomResolveOpts,
  ResolvedAxisValue,
} from "../core/cascadeAxes.js";
import { CASCADE_TIER_ORDER } from "../core/cascadeAxes.js";
import type { TriviaAnswersFormat } from "../core/types.js";
import { resolveDifficultyRanges, resolveDifficultyRatio } from "./difficulty.js";

/** Trimmed value, treating whitespace-only / absent as `undefined`. */
function nonEmpty(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/** The three axes whose resolution is bespoke (not the generic first-wins walk). */
type CustomAxisKey = "difficulty" | "difficultyRatio" | "additionalInstructions";
/** The axes the generic walker handles: their resolved type IS their field type. */
type FirstWinsKey = Exclude<keyof CascadeAxes, CustomAxisKey>;

/** The four tier objects of a context, in precedence order. */
function tierObjects(ctx: CascadeContext): Record<ConcreteTier, CascadeAxes | null> {
  return {
    seasonSlot: ctx.seasonSlot,
    season: ctx.season,
    gameSlot: ctx.gameSlot,
    game: ctx.game,
    workspace: ctx.config,
  };
}

/**
 * Generic first-wins walk over slot → season → game → workspace → default. Reads each
 * tier by key (every tier extends `CascadeAxes`) and returns the first defined value
 * (or the registry default), with a ladder of the four concrete tiers' raw values.
 *
 * Constrained to `FirstWinsKey`, for which the field type and the resolved type
 * coincide, so the read value is a sound `ResolvedAxisValue<K>` once narrowed.
 */
function firstWins<K extends FirstWinsKey>(
  key: K,
  ctx: CascadeContext,
  def: ResolvedAxisValue<K>,
): CascadeResolution<K> {
  const tiers = tierObjects(ctx);

  let winnerTier: CascadeTier = "default";
  let winnerValue: ResolvedAxisValue<K> = def;
  for (const tier of CASCADE_TIER_ORDER) {
    const raw = tiers[tier]?.[key];
    if (raw !== undefined) {
      winnerTier = tier;
      // Sound for FirstWinsKey (field type === resolved type), but TS can't reduce the
      // conditional `ResolvedAxisValue<K>` for an abstract K, so assert at this one spot.
      winnerValue = raw as ResolvedAxisValue<K>;
      break;
    }
  }

  const ladder: CascadeLadderEntry<CascadeAxes[K]>[] = CASCADE_TIER_ORDER.map((tier) => {
    const raw = tiers[tier]?.[key];
    return { tier, value: raw, present: raw !== undefined, winner: tier === winnerTier };
  });

  return { value: winnerValue, tier: winnerTier, ladder };
}

/** Build a first-wins registry entry, capturing the key and its default. */
function makeFirstWins<K extends FirstWinsKey>(key: K, def: ResolvedAxisValue<K>): AxisDef<K> {
  return { kind: "first-wins", default: def, resolve: (ctx) => firstWins(key, ctx, def) };
}

/** Require an answersFormat for the answersFormat-keyed custom axes. */
function requireFormat(opts: CustomResolveOpts, axis: string): TriviaAnswersFormat {
  if (opts.answersFormat === undefined) {
    throw new Error(`resolveCascade("${axis}") requires opts.answersFormat`);
  }
  return opts.answersFormat;
}

/**
 * `difficulty` custom resolver. Value delegates to `resolveDifficultyRanges`
 * (byte-identical). Provenance: per-field merge, so `"merged"` when more than one tier
 * contributes a `[easy|medium|hard]` slice for the format.
 */
function resolveDifficultyCustom(
  ctx: CascadeContext,
  opts: CustomResolveOpts,
): CascadeResolution<"difficulty"> {
  const format = requireFormat(opts, "difficulty");
  const value = resolveDifficultyRanges(ctx, format);
  const tiers = tierObjects(ctx);

  const contributing: ConcreteTier[] = [];
  const ladder: CascadeLadderEntry<CascadeAxes["difficulty"]>[] = CASCADE_TIER_ORDER.map((tier) => {
    const raw = tiers[tier]?.difficulty;
    const present = raw?.[format] !== undefined;
    if (present) contributing.push(tier);
    return { tier, value: present ? raw : undefined, present, winner: present };
  });

  const tier: CascadeTier =
    contributing.length === 0 ? "default" : contributing.length === 1 ? contributing[0] : "merged";
  return { value, tier, ladder };
}

/**
 * `difficultyRatio` custom resolver. Whole-object replace per tier (first-wins), but
 * answersFormat-keyed, so it cannot ride the generic by-key walker.
 */
function resolveDifficultyRatioCustom(
  ctx: CascadeContext,
  opts: CustomResolveOpts,
): CascadeResolution<"difficultyRatio"> {
  const format = requireFormat(opts, "difficultyRatio");
  const value = resolveDifficultyRatio(ctx, format);
  const tiers = tierObjects(ctx);

  let winnerTier: CascadeTier = "default";
  for (const tier of CASCADE_TIER_ORDER) {
    if (tiers[tier]?.difficultyRatio?.[format] !== undefined) {
      winnerTier = tier;
      break;
    }
  }
  const ladder: CascadeLadderEntry<CascadeAxes["difficultyRatio"]>[] = CASCADE_TIER_ORDER.map(
    (tier) => {
      const raw = tiers[tier]?.difficultyRatio;
      const present = raw?.[format] !== undefined;
      return { tier, value: present ? raw : undefined, present, winner: tier === winnerTier };
    },
  );
  return { value, tier: winnerTier, ladder };
}

/** Human-readable label for each tier's `additionalInstructions` segment. */
const ADDITIONAL_INSTRUCTIONS_LABEL: Record<ConcreteTier, (slotIndex: number | null) => string> = {
  workspace: () => "[Workspace]",
  game: () => "[Game]",
  gameSlot: (i) => `[Game Slot ${i ?? 0}]`,
  season: () => "[Season]",
  seasonSlot: (i) => `[Season Slot ${i ?? 0}]`,
};

/**
 * `additionalInstructions` custom resolver. CUMULATIVE: concatenates each contributing
 * tier's non-empty segment, broadest-first (`workspace → game → gameSlot → season →
 * seasonSlot`), each prefixed with its tier label. Reads the context tiers directly so
 * value and ladder cannot disagree. `"merged"` when more than one tier contributes.
 */
function resolveAdditionalInstructionsCustom(
  ctx: CascadeContext,
): CascadeResolution<"additionalInstructions"> {
  const tiers = tierObjects(ctx);
  const broadestFirst = [...CASCADE_TIER_ORDER].reverse();

  const segments: string[] = [];
  const contributing: ConcreteTier[] = [];
  for (const tier of broadestFirst) {
    const v = nonEmpty(tiers[tier]?.additionalInstructions);
    if (v !== undefined) {
      segments.push(`${ADDITIONAL_INSTRUCTIONS_LABEL[tier](ctx.slotIndex)} ${v}`);
      contributing.push(tier);
    }
  }
  const value = segments.length === 0 ? null : segments.join("\n\n");

  const ladder: CascadeLadderEntry<CascadeAxes["additionalInstructions"]>[] =
    CASCADE_TIER_ORDER.map((tier) => {
      const present = contributing.includes(tier);
      return {
        tier,
        value: present ? tiers[tier]?.additionalInstructions : undefined,
        present,
        winner: present,
      };
    });

  const tier: CascadeTier =
    contributing.length === 0 ? "default" : contributing.length === 1 ? contributing[0] : "merged";
  return { value, tier, ladder };
}

/**
 * The registry: exactly one entry per `CascadeAxes` key. The `AxisRegistry` mapped type
 * makes a missing or extra key a COMPILE ERROR — this is the sync lock that keeps
 * config-parsing, generation, post, audit, and `explain_cascade` from ever drifting.
 */
export const AXIS_REGISTRY: AxisRegistry = {
  answersFormat: makeFirstWins("answersFormat", DEFAULT_ANSWERS_FORMAT_WEIGHTS),
  questionType: makeFirstWins("questionType", DEFAULT_QUESTION_TYPE_WEIGHTS),
  promptMedium: makeFirstWins("promptMedium", DEFAULT_PROMPT_MEDIUM_WEIGHTS),
  freeformAnswerShape: makeFirstWins("freeformAnswerShape", DEFAULT_FREEFORM_ANSWER_SHAPE_WEIGHTS),
  contexts: makeFirstWins("contexts", null),
  hint: makeFirstWins("hint", DEFAULT_HINT_CONFIG),
  judgeLeniency: makeFirstWins("judgeLeniency", DEFAULT_JUDGE_LENIENCY),
  choices: makeFirstWins("choices", DEFAULT_TRIVIA_CHOICES),
  choiceEmojiStyle: makeFirstWins("choiceEmojiStyle", DEFAULT_CHOICE_EMOJI_STYLE),
  instructions: makeFirstWins("instructions", null),
  liveAnswersVisible: makeFirstWins("liveAnswersVisible", true),
  revealResponses: makeFirstWins("revealResponses", "yes"),
  difficulty: { kind: "custom", resolve: resolveDifficultyCustom },
  difficultyRatio: { kind: "custom", resolve: resolveDifficultyRatioCustom },
  additionalInstructions: { kind: "custom", resolve: resolveAdditionalInstructionsCustom },
};

/**
 * The cascade-axis keys, as a typed tuple for cast-free iteration by the read tools
 * (`list_games`, `explain_cascade`). A test asserts this equals `Object.keys(AXIS_REGISTRY)`,
 * so it cannot silently drift from the registry.
 */
export const AXIS_KEYS: readonly (keyof CascadeAxes)[] = [
  "answersFormat",
  "questionType",
  "promptMedium",
  "freeformAnswerShape",
  "contexts",
  "hint",
  "judgeLeniency",
  "choices",
  "choiceEmojiStyle",
  "instructions",
  "liveAnswersVisible",
  "revealResponses",
  "difficulty",
  "difficultyRatio",
  "additionalInstructions",
];

/** Copy `src[key]` onto `dst` when set. Generic-key-safe (no cast). */
export function copyAxisIfSet<K extends keyof CascadeAxes>(
  dst: Partial<CascadeAxes>,
  src: CascadeAxes,
  key: K,
): void {
  const v = src[key];
  if (v !== undefined) dst[key] = v;
}

/**
 * Resolve one cascading axis for a `(game, slot)` coordinate. Returns the value, the
 * winning tier, and the full ladder. `opts.answersFormat` is required for `difficulty`
 * and `difficultyRatio`.
 */
export function resolveCascade<K extends keyof CascadeAxes>(
  key: K,
  ctx: CascadeContext,
  opts: CustomResolveOpts = {},
): CascadeResolution<K> {
  // The registry is exhaustive by construction (the `AxisRegistry` mapped type enforces
  // it), so this is never undefined — the guard just satisfies the indexed-access check.
  const def: AxisDef<K> | undefined = AXIS_REGISTRY[key];
  if (def === undefined) {
    throw new Error(`No AXIS_REGISTRY entry for axis "${String(key)}"`);
  }
  return def.resolve(ctx, opts);
}
