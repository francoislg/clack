import type { TriviaConfig, TriviaGame, TriviaTellMeMoreConfig } from "../core/configTypes.js";
import { DEFAULT_TELL_ME_MORE } from "../core/configTypes.js";

/**
 * Pure resolver for the `tellMeMore` affordance. Cascade:
 *   `game.tellMeMore → workspace.tellMeMore → { enabled: false }`.
 *
 * No season or slot tier (like `allTimeRow`). The first tier that supplies a
 * value wins; when none does, returns the disabled default.
 */
export function resolveTellMeMore(
  game: TriviaGame | null,
  workspace: TriviaConfig | null,
): TriviaTellMeMoreConfig {
  if (game?.tellMeMore !== undefined) return game.tellMeMore;
  if (workspace?.tellMeMore !== undefined) return workspace.tellMeMore;
  return DEFAULT_TELL_ME_MORE;
}
