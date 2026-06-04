import type {
  TriviaConfig,
  TriviaGame,
  TriviaIncludeRevealInQuestions,
} from "../core/configTypes.js";
import { DEFAULT_INCLUDE_REVEAL_IN_QUESTIONS } from "../core/configTypes.js";

/**
 * Pure resolver for the `includeRevealInQuestions` axis. Cascade:
 *   `game.includeRevealInQuestions → workspace.includeRevealInQuestions → "no"`.
 *
 * No season or slot tier (mirrors `resolveAllTimeRow`). The first tier that
 * supplies a value wins; when no tier supplies one, returns the built-in
 * default `"no"` (cards carry only the deterministic facts footer).
 */
export function resolveIncludeRevealInQuestions(
  game: TriviaGame | null,
  workspace: TriviaConfig | null,
): TriviaIncludeRevealInQuestions {
  if (game?.includeRevealInQuestions !== undefined) return game.includeRevealInQuestions;
  if (workspace?.includeRevealInQuestions !== undefined) return workspace.includeRevealInQuestions;
  return DEFAULT_INCLUDE_REVEAL_IN_QUESTIONS;
}
