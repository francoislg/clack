import { saveTriviaConfig } from "../core/configBridge.js";
import type { TriviaConfig } from "../core/configTypes.js";
import type { SeasonEntry, SeasonsState } from "../core/types.js";

// The helper needs only a per-game seasons writer — narrower than the full TriviaDataLayer, so it
// stays decoupled and trivially fakeable. The real data layer satisfies it structurally.
interface SeasonsWriter {
  forGame(name: string): { saveSeasonsState(state: SeasonsState): Promise<void> };
}

/**
 * Persist a game write and, for a brand-new seasons-on game, its first season.
 *
 * The season is written BEFORE the game config on purpose: if the config write then fails, the
 * only residue is an orphaned seasons file for a game that does not exist in config (never read,
 * overwritten by the next create). The reverse order would risk a live game whose missing season
 * gets silently auto-bootstrapped to a different one than the admin requested.
 */
export async function persistGameWrite(
  nextConfig: TriviaConfig,
  opts: { gameName: string; data?: SeasonsWriter; initialSeasonEntry?: SeasonEntry },
): Promise<void> {
  if (opts.initialSeasonEntry !== undefined && opts.data !== undefined) {
    await opts.data.forGame(opts.gameName).saveSeasonsState({ seasons: [opts.initialSeasonEntry] });
  }
  await saveTriviaConfig(nextConfig);
}
