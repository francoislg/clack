import type { TriviaHintConfig } from "../core/configTypes.js";

const BUCKET_ORDER: Record<"easy" | "medium" | "hard", number> = {
  easy: 0,
  medium: 1,
  hard: 2,
};

/**
 * `true` iff `rolled` is at or above `min` in the difficulty ordering
 * `easy < medium < hard`. Used by `get_ideas` to gate hint generation when
 * the resolved hint config carries a `minDifficulty` threshold.
 */
export function difficultyMeetsThreshold(
  rolled: "easy" | "medium" | "hard",
  min: "easy" | "medium" | "hard",
): boolean {
  return BUCKET_ORDER[rolled] >= BUCKET_ORDER[min];
}

/**
 * Compute the effective hint mode for the current question, after applying
 * any `minDifficulty` threshold against the rolled difficulty bucket. When
 * the resolved config's `mode` is `"none"`, returns `"none"` directly. When
 * `minDifficulty` is unset, returns the resolved mode. When `minDifficulty`
 * is set, returns the resolved mode iff the rolled bucket meets the
 * threshold, otherwise `"none"`.
 */
export function effectiveHintMode(
  config: TriviaHintConfig,
  rolledDifficulty: "easy" | "medium" | "hard",
): "none" | "button" | "inline" {
  if (config.mode === "none") return "none";
  if (!config.minDifficulty) return config.mode;
  return difficultyMeetsThreshold(rolledDifficulty, config.minDifficulty) ? config.mode : "none";
}
