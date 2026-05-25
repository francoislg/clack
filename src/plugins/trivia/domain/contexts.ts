import type { TriviaConfig, TriviaContextEntry, TriviaGame } from "../core/configTypes.js";
import type { SeasonEntry } from "../core/types.js";

/**
 * Pure resolver for the contexts (lens) axis. Returns `null` when no cascade tier
 * provides a contexts list — that signals "no lens applied" to `get_ideas`, which
 * omits `contextPriority` from the response and falls back to today's lens-free
 * generation behavior.
 *
 * Priority order (first non-null source wins):
 *   1. Slot's `contexts` — when the season has a format and the slot defines `contexts`.
 *   2. Season's `contexts`.
 *   3. Game's `contexts` — per-game tier between season and workspace.
 *   4. `config.trivia.contexts` — workspace default.
 *   5. `null` — no contexts configured anywhere.
 */
export function resolveContexts(
  currentSeason: SeasonEntry | null,
  slotIndex: number | null,
  game: TriviaGame | null,
  triviaConfig: TriviaConfig | null,
): TriviaContextEntry[] | null {
  if (currentSeason !== null && slotIndex !== null && currentSeason.format !== undefined) {
    const slot = currentSeason.format.questions[slotIndex];
    if (slot?.contexts !== undefined) {
      return slot.contexts;
    }
  }
  if (currentSeason?.contexts !== undefined) {
    return currentSeason.contexts;
  }
  if (game?.contexts !== undefined) {
    return game.contexts;
  }
  if (triviaConfig?.contexts !== undefined) {
    return triviaConfig.contexts;
  }
  return null;
}

/**
 * Produce a freshly-rolled weighted-random ordering of the given contexts (sampling
 * without replacement, weighted by `weight ?? 1`). Each call rolls independently —
 * caller's responsibility to invoke once per `get_ideas` response.
 *
 * High-weight entries are likelier to land near the front. The empty-string entry
 * is a first-class member of the rolled list — it's how "no lens" is expressed.
 *
 * Returns a `string[]` of `name` values (NOT the full entries) because that's all
 * downstream (Claude's prompt + `save_question.context` validation) needs to see.
 */
export function rollContextPriority(contexts: TriviaContextEntry[]): string[] {
  if (contexts.length === 0) return [];

  // Mutable copy of remaining (entry, effective weight) pairs.
  const remaining: { name: string; weight: number }[] = contexts.map((c) => ({
    name: c.name,
    weight: c.weight ?? 1,
  }));

  const out: string[] = [];
  while (remaining.length > 0) {
    const totalWeight = remaining.reduce((sum, e) => sum + e.weight, 0);
    let pick = Math.random() * totalWeight;
    let idx = 0;
    for (; idx < remaining.length; idx++) {
      pick -= remaining[idx].weight;
      if (pick <= 0) break;
    }
    if (idx === remaining.length) idx = remaining.length - 1;
    out.push(remaining[idx].name);
    remaining.splice(idx, 1);
  }
  return out;
}
