/**
 * The synthetic-owner key convention for shared-buzzer team rows, isolated in a
 * dependency-free leaf so any consumer (strategy, leaderboard, round summary,
 * reveal cards) can tell a projected team row from an individual one without
 * pulling in the strategy module (which would form an import cycle).
 *
 * A team's projected `SubmittedAnswer` carries `userId: "team:<name>"`. Slack user
 * IDs never contain `:`, so this can never collide with a real userId.
 */
export const TEAM_KEY_PREFIX = "team:";

export function teamOwnerKey(teamName: string): string {
  return `${TEAM_KEY_PREFIX}${teamName}`;
}

export function isTeamOwnerKey(key: string): boolean {
  return key.startsWith(TEAM_KEY_PREFIX);
}

export function teamNameFromOwnerKey(key: string): string {
  return key.slice(TEAM_KEY_PREFIX.length);
}
