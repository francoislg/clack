import type {
  DifficultyRanges,
  DifficultyRangesInput,
  TriviaConfig,
  TriviaGame,
} from "../core/configTypes.js";
import { DEFAULT_DIFFICULTY_RANGES } from "../core/configTypes.js";
import type { SeasonEntry, TriviaAnswersFormat } from "../core/types.js";

/**
 * Pure resolver for per-game-type difficulty ranges. Mirrors `resolveAnswersFormat` /
 * `resolveFreeformAnswerShape`, but with per-field merge instead of whole-object replace —
 * each tier can override any subset of `easy` / `medium` / `hard` / `minimumThreshold`
 * and the missing fields cascade from the next tier.
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
      minimumThreshold: layer.minimumThreshold ?? resolved.minimumThreshold,
    };
  }
  return resolved;
}
