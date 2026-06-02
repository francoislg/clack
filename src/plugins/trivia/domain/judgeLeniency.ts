import type { SeasonEntry } from "../core/types.js";
import type { JudgeLeniency, TriviaConfig, TriviaGame } from "../core/configTypes.js";
import { DEFAULT_JUDGE_LENIENCY } from "../core/configTypes.js";

/**
 * Pure resolver for the `judgeLeniency` axis. Cascade:
 *   `season.format.questions[slotIndex].judgeLeniency → season.judgeLeniency →
 *    game.judgeLeniency → workspace.judgeLeniency → "strict-with-typos"`.
 *
 * Whole-value replace per tier (no merging). The first tier that supplies a
 * value wins. When no tier supplies one, returns the built-in default
 * `DEFAULT_JUDGE_LENIENCY` (`"strict-with-typos"`).
 */
export function resolveJudgeLeniency(
  slotIndex: number | null,
  currentSeason: SeasonEntry | null,
  game: TriviaGame | null,
  workspace: TriviaConfig | null,
): JudgeLeniency {
  if (slotIndex !== null && currentSeason?.format) {
    const slot = currentSeason.format.questions[slotIndex];
    if (slot?.judgeLeniency !== undefined) return slot.judgeLeniency;
  }
  if (currentSeason?.judgeLeniency !== undefined) return currentSeason.judgeLeniency;
  if (game?.judgeLeniency !== undefined) return game.judgeLeniency;
  if (workspace?.judgeLeniency !== undefined) return workspace.judgeLeniency;
  return DEFAULT_JUDGE_LENIENCY;
}
