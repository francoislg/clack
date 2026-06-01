import type { TriviaConfig, PromptMediumWeights, TriviaGame } from "../core/configTypes.js";
import { DEFAULT_PROMPT_MEDIUM_WEIGHTS } from "../core/configTypes.js";
import type { SeasonsState, SeasonEntry, ScopedTriviaDataLayer } from "../core/types.js";
import { findCurrentSeason } from "../core/seasonTimeline.js";

/**
 * Pure resolver for the prompt-medium axis (text vs image) given an already-resolved
 * season entry (possibly null), optional slot index, and optional per-game entry.
 *
 * Priority order (first non-null source wins):
 *   1. Slot's `promptMedium` — when the season has a format, slot index is in range,
 *      and the slot defines `promptMedium`.
 *   2. Season's `promptMedium`.
 *   3. Game's `promptMedium` — per-game tier between season and workspace.
 *   4. `config.trivia.promptMedium` — workspace default.
 *   5. `DEFAULT_PROMPT_MEDIUM_WEIGHTS` (`{ text: 1, image: 0 }`) — pre-visual fallback.
 */
export function resolvePromptMedium(
  currentSeason: SeasonEntry | null,
  slotIndex: number | null,
  game: TriviaGame | null,
  triviaConfig: TriviaConfig | null,
): PromptMediumWeights {
  if (currentSeason !== null && slotIndex !== null && currentSeason.format !== undefined) {
    const slot = currentSeason.format.questions[slotIndex];
    if (slot?.promptMedium !== undefined) {
      return slot.promptMedium;
    }
  }
  if (currentSeason?.promptMedium !== undefined) {
    return currentSeason.promptMedium;
  }
  if (game?.promptMedium !== undefined) {
    return game.promptMedium;
  }
  if (triviaConfig?.promptMedium !== undefined) {
    return triviaConfig.promptMedium;
  }
  return DEFAULT_PROMPT_MEDIUM_WEIGHTS;
}

/**
 * Resolves the active prompt-medium weights for `get_ideas` (no slot). Re-reads
 * season state on every call so mid-season edits take effect on the next invocation.
 */
export async function getActivePromptMedium(
  scoped: ScopedTriviaDataLayer,
  triviaConfig: TriviaConfig | null,
  now: number,
  game: TriviaGame | null,
): Promise<PromptMediumWeights> {
  const seasonsEnabled = triviaConfig?.seasons?.enabled ?? false;
  let current: SeasonEntry | null = null;
  if (seasonsEnabled) {
    const state: SeasonsState | null = await scoped.loadSeasonsState();
    current = findCurrentSeason(state, now);
  }
  return resolvePromptMedium(current, null, game, triviaConfig);
}
