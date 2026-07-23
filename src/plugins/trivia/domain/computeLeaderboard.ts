import type { SubmittedAnswer, TriviaQuestion, TriviaUser } from "../core/types.js";
import { isTeamOwnerKey } from "../answering/teamKey.js";

export interface LeaderboardEntry {
  userId: string;
  displayName: string;
  totalCorrect: number;
  totalAnswered: number;
  /** All-time points: each correct row pays its question's stamped `points` (absent = 1). */
  totalPoints: number;
  accuracy: number;
  currentSeasonCorrect?: number;
  currentSeasonAnswered?: number;
  currentSeasonPoints?: number;
}

/**
 * questionId → stamped `points`. A questionId absent from the map pays 1, which is
 * how legacy rows and 1-point questions read. Callers build this by loading the
 * game's questions; points are deliberately NOT denormalized onto answer rows, so
 * every verdict mutation (override_answer, replay, invalidation, freeform judging)
 * re-prices through this join with no extra bookkeeping.
 */
export type QuestionPointsMap = ReadonlyMap<string, number>;

/**
 * Build the join map from a game's question records. Only questions worth more than 1
 * are entered — everything else falls through to the `?? 1` default at read time.
 */
export function buildQuestionPointsMap(
  questions: readonly Pick<TriviaQuestion, "id" | "points">[],
): QuestionPointsMap {
  const map = new Map<string, number>();
  for (const q of questions) {
    if (q.points !== undefined && q.points > 1) map.set(q.id, q.points);
  }
  return map;
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
  totalPoints: number;
}

const EMPTY_COUNTS: Counts = { totalCorrect: 0, totalAnswered: 0, totalPoints: 0 };

function aggregate(
  answers: SubmittedAnswer[],
  questionPoints: QuestionPointsMap,
): Map<string, Counts> {
  const scoreMap = new Map<string, Counts>();
  for (const answer of answers) {
    // Skip pending freeform rows entirely — they're not yet scored and must not
    // affect totalAnswered or totalCorrect until the reveal-time judge flips
    // `correct` to a boolean.
    if (answer.correct === undefined) continue;
    const entry = scoreMap.get(answer.userId) ?? { ...EMPTY_COUNTS };
    entry.totalAnswered++;
    if (answer.correct === true) {
      entry.totalCorrect++;
      entry.totalPoints += questionPoints.get(answer.questionId) ?? 1;
    }
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
 *    `accuracy`. `totalCorrect`/`totalAnswered`/`totalPoints` on the returned entry are still
 *    ALL-TIME totals (this matches retrieve_scores' historical shape — accuracy is per-scope,
 *    raw totals are cumulative).
 *  - `currentSeasonCorrect`/`currentSeasonAnswered`/`currentSeasonPoints` are added when
 *    `currentSeasonSlug` is set.
 *  - Sort is POINTS-primary: `totalCorrect` mode sorts by `totalPoints` desc with `accuracy`
 *    tiebreak; `accuracy` mode sorts by `accuracy` desc with `totalPoints` tiebreak. When every
 *    question is worth 1, `totalPoints === totalCorrect`, so both orderings are identical to
 *    the pre-points behavior.
 *  - `limit` (default 10) trims the result.
 */
export function computeLeaderboard(
  allAnswers: SubmittedAnswer[],
  users: Map<string, TriviaUser>,
  questionPoints: QuestionPointsMap,
  options: ComputeLeaderboardOptions,
): ComputeLeaderboardResult {
  const limit = options.limit ?? 10;

  // The individual leaderboard never lists teams — shared-buzzer results render
  // exclusively in team standings. Synthetic `team:` rows are filtered out here.
  const individualAnswers = allAnswers.filter((a) => !isTeamOwnerKey(a.userId));

  const primaryAnswers =
    options.primaryFilterSeason === null
      ? individualAnswers
      : individualAnswers.filter((a) => a.season === options.primaryFilterSeason);
  const primaryMap = aggregate(primaryAnswers, questionPoints);
  const allTimeMap = aggregate(individualAnswers, questionPoints);
  const currentSeasonMap =
    options.currentSeasonSlug !== null
      ? aggregate(
          individualAnswers.filter((a) => a.season === options.currentSeasonSlug),
          questionPoints,
        )
      : null;

  const compare =
    options.sortBy === "accuracy"
      ? (a: LeaderboardEntry, b: LeaderboardEntry) =>
          b.accuracy - a.accuracy || b.totalPoints - a.totalPoints
      : (a: LeaderboardEntry, b: LeaderboardEntry) =>
          b.totalPoints - a.totalPoints || b.accuracy - a.accuracy;

  const leaderboard: LeaderboardEntry[] = [...primaryMap.entries()]
    .map(([userId, stats]) => {
      const user = users.get(userId);
      const allTime = allTimeMap.get(userId) ?? EMPTY_COUNTS;
      const entry: LeaderboardEntry = {
        userId,
        displayName: user?.displayName ?? userId,
        totalCorrect: allTime.totalCorrect,
        totalAnswered: allTime.totalAnswered,
        totalPoints: allTime.totalPoints,
        accuracy:
          stats.totalAnswered > 0
            ? Math.round((stats.totalCorrect / stats.totalAnswered) * 100)
            : 0,
      };
      if (currentSeasonMap !== null) {
        const cs = currentSeasonMap.get(userId) ?? EMPTY_COUNTS;
        entry.currentSeasonCorrect = cs.totalCorrect;
        entry.currentSeasonAnswered = cs.totalAnswered;
        entry.currentSeasonPoints = cs.totalPoints;
      }
      return entry;
    })
    .sort(compare)
    .slice(0, limit);

  return { leaderboard, totalPlayers: primaryMap.size };
}
