/**
 * Validates a game-name string at runtime: same shape enforced by `parseTriviaGames`
 * at config-load time (lowercase letters, digits, hyphens; length 1–32).
 *
 * Used by tools that accept a `game: string` arg to give Claude a clear error
 * shape when the slug is malformed — though in practice the registry-presence
 * check fails first if Claude passes anything Clack hasn't seen before.
 */
const GAME_NAME_RE = /^[a-z0-9-]+$/;

export function isValidGameName(name: string): boolean {
  if (name.length < 1 || name.length > 32) return false;
  return GAME_NAME_RE.test(name);
}
