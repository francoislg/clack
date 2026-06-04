import type { TriviaConfig, TriviaFinalRevealSummary, TriviaGame } from "../core/configTypes.js";
import { DEFAULT_FINAL_REVEAL_SUMMARY } from "../core/configTypes.js";

/**
 * Pure resolver for the `finalRevealSummary` axis. Cascade:
 *   `game.finalRevealSummary → workspace.finalRevealSummary → "yes"`.
 *
 * No season or slot tier (mirrors `resolveAllTimeRow`). The first tier that
 * supplies a value wins; when no tier supplies one, returns the built-in
 * default `"yes"` (verdict/WHY/voter narrative posted top-level alongside the
 * leaderboard).
 */
export function resolveFinalRevealSummary(
  game: TriviaGame | null,
  workspace: TriviaConfig | null,
): TriviaFinalRevealSummary {
  if (game?.finalRevealSummary !== undefined) return game.finalRevealSummary;
  if (workspace?.finalRevealSummary !== undefined) return workspace.finalRevealSummary;
  return DEFAULT_FINAL_REVEAL_SUMMARY;
}
