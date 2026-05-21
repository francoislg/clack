import type { SubmittedAnswer, TriviaUser } from "../core/types.js";

export interface LeaderboardEntry {
  userId: string;
  displayName: string;
  totalCorrect: number;
  totalAnswered: number;
  accuracy: number;
  currentSeasonCorrect?: number;
  currentSeasonAnswered?: number;
}

export interface ComputeLeaderboardOptions {
  sortBy: "totalCorrect" | "accuracy";
  limit?: number;
  /**
   * Primary scope for ranking. When seasons are off, pass `null` and the primary set is all
   * answers. When seasons are on, pass the current season's slug to scope ranking to that
   * season; pass `null` for the cross-season ("all") view; pass a historical slug for that
   * season's view.
   */
  primaryFilterSeason: string | null;
  /**
   * Current season slug, used to populate `currentSeasonCorrect` / `currentSeasonAnswered`
   * on every entry. When `null`, those fields are omitted (seasons disabled or in a gap).
   */
  currentSeasonSlug: string | null;
}

interface Counts {
  totalCorrect: number;
  totalAnswered: number;
}

function aggregate(answers: SubmittedAnswer[]): Map<string, Counts> {
  const scoreMap = new Map<string, Counts>();
  for (const answer of answers) {
    // Skip pending freeform rows entirely — they're not yet scored and must not
    // affect totalAnswered or totalCorrect until the reveal-time judge flips
    // `correct` to a boolean.
    if (answer.correct === undefined) continue;
    const entry = scoreMap.get(answer.userId) ?? { totalCorrect: 0, totalAnswered: 0 };
    entry.totalAnswered++;
    if (answer.correct === true) entry.totalCorrect++;
    scoreMap.set(answer.userId, entry);
  }
  return scoreMap;
}

export interface ComputeLeaderboardResult {
  leaderboard: LeaderboardEntry[];
  totalPlayers: number;
}

/**
 * Pure aggregation: take the full answer set + user map and produce a ranked leaderboard.
 * Single source of truth shared by `retrieve_scores` and `process_reveal_answers`.
 *
 * Ranking semantics:
 *  - The PRIMARY set (filtered by `primaryFilterSeason`) is the basis for who appears and for
 *    `accuracy`. `totalCorrect`/`totalAnswered` on the returned entry are still ALL-TIME totals
 *    (this matches retrieve_scores' historical shape — accuracy is per-scope, raw totals are
 *    cumulative).
 *  - `currentSeasonCorrect`/`currentSeasonAnswered` are added when `currentSeasonSlug` is set.
 *  - Sort: `totalCorrect` first by `totalCorrect` desc with `accuracy` tiebreak; `accuracy`
 *    first by `accuracy` desc with `totalCorrect` tiebreak.
 *  - `limit` (default 10) trims the result.
 */
export function computeLeaderboard(
  allAnswers: SubmittedAnswer[],
  users: Map<string, TriviaUser>,
  options: ComputeLeaderboardOptions,
): ComputeLeaderboardResult {
  const limit = options.limit ?? 10;

  const primaryAnswers =
    options.primaryFilterSeason === null
      ? allAnswers
      : allAnswers.filter((a) => a.season === options.primaryFilterSeason);
  const primaryMap = aggregate(primaryAnswers);
  const allTimeMap = aggregate(allAnswers);
  const currentSeasonMap =
    options.currentSeasonSlug !== null
      ? aggregate(allAnswers.filter((a) => a.season === options.currentSeasonSlug))
      : null;

  const compare =
    options.sortBy === "accuracy"
      ? (a: LeaderboardEntry, b: LeaderboardEntry) =>
          b.accuracy - a.accuracy || b.totalCorrect - a.totalCorrect
      : (a: LeaderboardEntry, b: LeaderboardEntry) =>
          b.totalCorrect - a.totalCorrect || b.accuracy - a.accuracy;

  const leaderboard: LeaderboardEntry[] = [...primaryMap.entries()]
    .map(([userId, stats]) => {
      const user = users.get(userId);
      const allTime = allTimeMap.get(userId) ?? { totalCorrect: 0, totalAnswered: 0 };
      const entry: LeaderboardEntry = {
        userId,
        displayName: user?.displayName ?? userId,
        totalCorrect: allTime.totalCorrect,
        totalAnswered: allTime.totalAnswered,
        accuracy:
          stats.totalAnswered > 0
            ? Math.round((stats.totalCorrect / stats.totalAnswered) * 100)
            : 0,
      };
      if (currentSeasonMap !== null) {
        const cs = currentSeasonMap.get(userId) ?? { totalCorrect: 0, totalAnswered: 0 };
        entry.currentSeasonCorrect = cs.totalCorrect;
        entry.currentSeasonAnswered = cs.totalAnswered;
      }
      return entry;
    })
    .sort(compare)
    .slice(0, limit);

  return { leaderboard, totalPlayers: primaryMap.size };
}
