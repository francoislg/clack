import { loadTriviaConfig } from "../core/configBridge.js";
import { persistGameWrite } from "./persistGame.js";
import type { TriviaConfig } from "../core/configTypes.js";

/**
 * Correction recipe surfaced whenever a game is wound down: a disabled game's
 * correction tools (`override_answer`, `settle_question`, …) refuse writes, so a
 * post-finale fix requires a temporary re-enable. The final manual re-disable is
 * load-bearing — nothing re-disables an already-ended round automatically.
 */
export const WIND_DOWN_RECIPE =
  "To correct anything later (override_answer, settle_question, …): re-enable the game " +
  "(upsert_game { enabled: true }), apply the fix, then disable it again " +
  "(upsert_game { enabled: false }). That final manual re-disable is load-bearing — " +
  "nothing re-disables an already-ended round automatically.";

export interface WindDownResult {
  gameDisabled: true;
  alreadyWoundDown?: true;
  message: string;
}

/**
 * THE wind-down executor — the only automated path to `enabled: false`. Both
 * `end_season` branches (season close and seasonless board-clear) funnel here.
 * Persists through the same config-write path as `upsert_game`, so the file
 * watcher / soft-restart behavior (which drops the game's cron specs) comes for
 * free. Idempotent: an already-disabled game is a no-op success.
 */
export async function windDownGame(gameName: string): Promise<WindDownResult> {
  const currentConfig: TriviaConfig = loadTriviaConfig() ?? {};
  const games = currentConfig.games ?? [];
  const entry = games.find((g) => g.name === gameName);
  // Callers validate via requireGame first; an unknown name here is a bug, and
  // silently "succeeding" would report a wind-down that never happened.
  if (entry === undefined) {
    throw new Error(`windDownGame: unknown game "${gameName}" — nothing to disable`);
  }
  if (entry.enabled === false) {
    return {
      gameDisabled: true,
      alreadyWoundDown: true,
      message: `Game "${gameName}" is already wound down (enabled: false). ${WIND_DOWN_RECIPE}`,
    };
  }
  const nextGames = games.map((g) => (g.name === gameName ? { ...g, enabled: false } : g));
  await persistGameWrite({ ...currentConfig, games: nextGames }, { gameName });
  return {
    gameDisabled: true,
    message:
      `Game "${gameName}" wound down: enabled is now false, its schedules stop, and no ` +
      `successor season was created. ${WIND_DOWN_RECIPE}`,
  };
}
