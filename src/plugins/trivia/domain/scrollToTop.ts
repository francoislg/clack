import type { TriviaConfig, TriviaGame } from "../core/configTypes.js";
import { DEFAULT_SCROLL_TO_TOP } from "../core/configTypes.js";

/**
 * Pure resolver for the `scrollToTop` knob. Cascade:
 *   `game.scrollToTop → workspace.scrollToTop → false`.
 *
 * No season or slot tier (like `tagPlayers`). The first tier that supplies a
 * value wins; when no tier supplies one, returns the built-in default `false`
 * (no trailing navigation message).
 */
export function resolveScrollToTop(
  game: TriviaGame | null,
  workspace: TriviaConfig | null,
): boolean {
  if (game?.scrollToTop !== undefined) return game.scrollToTop;
  if (workspace?.scrollToTop !== undefined) return workspace.scrollToTop;
  return DEFAULT_SCROLL_TO_TOP;
}
