import { getConfig } from "../../config.js";
import type { TriviaGame } from "../../config.js";

/**
 * Injection point for "list the registered trivia games."
 * Production reads via the shared config singleton; tests inject a literal.
 */
export type GetGamesFn = () => readonly TriviaGame[];

/** Default: read from the shared config; treat config-not-loaded (tests) as empty. */
export const defaultGetGames: GetGamesFn = () => {
  try {
    return getConfig().trivia?.games ?? [];
  } catch {
    return [];
  }
};
