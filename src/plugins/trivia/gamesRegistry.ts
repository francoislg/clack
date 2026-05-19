import type { TriviaGame } from "../../config.js";

export class UnknownGameError extends Error {
  readonly code = "unknown_game" as const;
  constructor(name: string) {
    super(
      `Unknown game "${name}". Call list_games to see configured games, or ask an admin to register one in config.trivia.games[].`,
    );
  }
}

export class GameDisabledError extends Error {
  readonly code = "game_disabled" as const;
  constructor(name: string) {
    super(
      `Game "${name}" is disabled (enabled: false). Writes are refused; ask an admin to re-enable it before resuming activity.`,
    );
  }
}

/**
 * Returns the registry entry for `name` or null. Disabled games are still findable
 * (they exist in the registry; readability is the caller's call).
 */
export function findGame(games: readonly TriviaGame[], name: string): TriviaGame | null {
  return games.find((g) => g.name === name) ?? null;
}

/**
 * Asserts the named game exists in the registry. Throws `UnknownGameError` otherwise.
 * For read-side validation; does NOT check `enabled` (disabled games allow reads
 * per the frozen-archive semantics).
 */
export function requireGame(games: readonly TriviaGame[], name: string): TriviaGame {
  const entry = findGame(games, name);
  if (entry === null) throw new UnknownGameError(name);
  return entry;
}

/**
 * Asserts the named game exists AND is not disabled. Throws `UnknownGameError`
 * or `GameDisabledError`. For write-side validation.
 */
export function requireWritableGame(games: readonly TriviaGame[], name: string): TriviaGame {
  const entry = requireGame(games, name);
  if (entry.enabled === false) throw new GameDisabledError(name);
  return entry;
}

/**
 * Returns the unique enabled game whose `channel` matches `channelId`, or null if
 * no enabled entry matches. Disabled games are excluded so a wound-down game's
 * channel doesn't accidentally route reactive trivia there.
 */
export function resolveGameFromChannel(
  games: readonly TriviaGame[],
  channelId: string,
): string | null {
  const match = games.find((g) => g.channel === channelId && g.enabled !== false);
  return match?.name ?? null;
}
