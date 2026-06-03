import type {
  DifficultyBucketWeights,
  DifficultyRanges,
  DifficultyRangesInput,
} from "../core/configTypes.js";
import { DEFAULT_DIFFICULTY_RANGES, DEFAULT_DIFFICULTY_RATIO } from "../core/configTypes.js";
import type { CascadeAxes, CascadeContext } from "../core/cascadeAxes.js";
import type { TriviaAnswersFormat } from "../core/types.js";

/**
 * The cascade tiers broadest-first (workspace → … → seasonSlot). The per-field merge
 * applies them in this order so the highest-precedence tier is applied LAST and wins.
 * First-wins resolution (difficultyRatio) walks the reverse.
 */
function tiersBroadestFirst(ctx: CascadeContext): readonly (CascadeAxes | null)[] {
  return [ctx.config, ctx.game, ctx.gameSlot, ctx.season, ctx.seasonSlot];
}

/**
 * Pure resolver for per-game-type difficulty ranges. Per-field merge: each tier can
 * override any subset of `easy` / `medium` / `hard`; missing fields cascade from the
 * next-broader tier. Reads the resolved slot objects off `ctx` — never re-derives a
 * slot from `season.format`.
 *
 * Precedence (highest wins): seasonSlot → season → gameSlot → game → workspace →
 * `DEFAULT_DIFFICULTY_RANGES[format]`.
 */
export function resolveDifficultyRanges(
  ctx: CascadeContext,
  format: TriviaAnswersFormat,
): DifficultyRanges {
  const layers: DifficultyRangesInput[] = [];
  for (const tier of tiersBroadestFirst(ctx)) {
    const v = tier?.difficulty?.[format];
    if (v !== undefined) layers.push(v);
  }
  let resolved: DifficultyRanges = DEFAULT_DIFFICULTY_RANGES[format];
  for (const layer of layers) {
    resolved = {
      easy: layer.easy ?? resolved.easy,
      medium: layer.medium ?? resolved.medium,
      hard: layer.hard ?? resolved.hard,
    };
  }
  return resolved;
}

/**
 * Pure resolver for the per-format bucket-roll ratio. Whole-object replace per tier
 * (first-wins): the highest-precedence tier that supplies a complete `{ easy, medium,
 * hard }` map for the format wins; lower tiers do not contribute partial values. Reads
 * the resolved slot objects off `ctx`.
 *
 * Precedence (highest wins): seasonSlot → season → gameSlot → game → workspace →
 * `DEFAULT_DIFFICULTY_RATIO[format]`.
 */
export function resolveDifficultyRatio(
  ctx: CascadeContext,
  format: TriviaAnswersFormat,
): DifficultyBucketWeights {
  const highestFirst = [...tiersBroadestFirst(ctx)].reverse();
  for (const tier of highestFirst) {
    const v = tier?.difficultyRatio?.[format];
    if (v !== undefined) return v;
  }
  return DEFAULT_DIFFICULTY_RATIO[format];
}
