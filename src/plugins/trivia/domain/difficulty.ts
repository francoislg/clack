import type {
  DifficultyBucketWeights,
  DifficultyRanges,
  DifficultyRangesInput,
  TriviaConfig,
  TriviaGame,
} from "../core/configTypes.js";
import { DEFAULT_DIFFICULTY_RANGES, DEFAULT_DIFFICULTY_RATIO } from "../core/configTypes.js";
import type { SeasonEntry, TriviaAnswersFormat } from "../core/types.js";

/**
 * Pure resolver for per-game-type difficulty ranges. Mirrors `resolveAnswersFormat` /
 * `resolveFreeformAnswerShape`, but with per-field merge instead of whole-object replace —
 * each tier can override any subset of `easy` / `medium` / `hard` and the missing fields
 * cascade from the next tier.
 *
 * Priority (later tiers override earlier ones):
 *   1. `DEFAULT_DIFFICULTY_RANGES[format]` — built-in baseline (boolean/choice softer
 *      than freeform; freeform is shifted -2 across every bucket).
 *   2. `config.trivia.difficulty[format]` — workspace default.
 *   3. `game.difficulty[format]` — per-game tier between workspace and season.
 *   4. `season.difficulty[format]` — per-season override.
 *   5. `slot.difficulty[format]` — per-slot override.
 *
 * The returned `DifficultyRanges` is FULLY resolved (no sparse fields).
 */
export function resolveDifficultyRanges(
  currentSeason: SeasonEntry | null,
  slotIndex: number | null,
  game: TriviaGame | null,
  triviaConfig: TriviaConfig | null,
  format: TriviaAnswersFormat,
): DifficultyRanges {
  const layers: DifficultyRangesInput[] = [];
  const fromConfig = triviaConfig?.difficulty?.[format];
  if (fromConfig !== undefined) layers.push(fromConfig);
  const fromGame = game?.difficulty?.[format];
  if (fromGame !== undefined) layers.push(fromGame);
  const fromSeason = currentSeason?.difficulty?.[format];
  if (fromSeason !== undefined) layers.push(fromSeason);
  if (currentSeason !== null && slotIndex !== null && currentSeason.format !== undefined) {
    const slot = currentSeason.format.questions[slotIndex];
    const fromSlot = slot?.difficulty?.[format];
    if (fromSlot !== undefined) layers.push(fromSlot);
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
 * Pure resolver for the per-format bucket-roll ratio. Unlike `resolveDifficultyRanges`,
 * this uses **whole-object replace per tier** — the first tier that supplies a complete
 * `{ easy, medium, hard }` weight map for the queried format wins; lower tiers do NOT
 * contribute partial values. Mirrors `resolveQuestionType` / `resolveAnswersFormat`.
 *
 * Why whole-object replace and not per-field merge: a `difficultyRatio` weight map is
 * a single statement of distribution. `{ easy: 5 }` at the slot tier should NOT mean
 * "set easy to 5, inherit medium/hard from above" — that produces surprising effective
 * distributions that depend on what other tiers happened to set. Atomic replacement
 * keeps the distribution auditable: the admin sees the full triple at the winning tier
 * and knows the full distribution without tracing the cascade. The `difficulty` ranges
 * use per-field merge because each bucket's `[min, max]` is independently meaningful.
 *
 * Priority (later tiers win):
 *   1. `DEFAULT_DIFFICULTY_RATIO[format]` — built-in baseline (boolean/choice 3/6/1
 *      preserves historical 30/60/10; freeform 5/4/1 skews easier).
 *   2. `config.trivia.difficultyRatio[format]` — workspace default.
 *   3. `game.difficultyRatio[format]` — per-game.
 *   4. `season.difficultyRatio[format]` — per-season.
 *   5. `slot.difficultyRatio[format]` — per-slot.
 */
export function resolveDifficultyRatio(
  currentSeason: SeasonEntry | null,
  slotIndex: number | null,
  game: TriviaGame | null,
  triviaConfig: TriviaConfig | null,
  format: TriviaAnswersFormat,
): DifficultyBucketWeights {
  if (currentSeason !== null && slotIndex !== null && currentSeason.format !== undefined) {
    const slot = currentSeason.format.questions[slotIndex];
    const fromSlot = slot?.difficultyRatio?.[format];
    if (fromSlot !== undefined) return fromSlot;
  }
  const fromSeason = currentSeason?.difficultyRatio?.[format];
  if (fromSeason !== undefined) return fromSeason;
  const fromGame = game?.difficultyRatio?.[format];
  if (fromGame !== undefined) return fromGame;
  const fromConfig = triviaConfig?.difficultyRatio?.[format];
  if (fromConfig !== undefined) return fromConfig;
  return DEFAULT_DIFFICULTY_RATIO[format];
}
