import type { RoundSummary, RoundSummaryEntry, PerfectRoundsChampion } from "./types.js";
import type { QuestionPointsMap } from "../../domain/computeLeaderboard.js";
import { isTeamOwnerKey } from "../../answering/teamKey.js";

/** Minimum question count for a clean sweep to earn `perfectRound`. */
export const PERFECT_ROUND_MIN_QUESTIONS = 3;

/**
 * Grouping key for a question's fire: its `batchId`, or a singleton key for a
 * legacy row without one. Shared so the season aggregation and the reveal's
 * oldest-pending-batch selection partition questions identically.
 */
export function batchKeyOf(question: { id: string; batchId?: string }): string {
  return question.batchId ?? `__singleton__:${question.id}`;
}

/** One scored answer to a revealed question — already cheater/bot/pending-filtered by the caller. */
export interface RoundAnswer {
  questionId: string;
  userId: string;
  correct: boolean;
}

/**
 * The set of userIds who answered EVERY question in `questionIds` correctly —
 * a "clean sweep". Returns an empty set when the fire has fewer than
 * PERFECT_ROUND_MIN_QUESTIONS questions (a 1-2 question sweep is not a perfect
 * round). Dedupes per (question, user); a user is "correct" on a question if
 * ANY of their rows for it is correct. Synthetic `team:` owner keys are excluded
 * (perfect rounds are an individual honor). A user must have a correct row for
 * EVERY question id (a missing answer disqualifies them).
 */
export function perfectRoundSweepers(
  questionIds: readonly string[],
  scoredAnswers: readonly RoundAnswer[],
): Set<string> {
  if (questionIds.length < PERFECT_ROUND_MIN_QUESTIONS) {
    return new Set<string>();
  }

  const questionSet = new Set(questionIds);
  const perQuestion = new Map<string, Map<string, boolean>>();

  for (const a of scoredAnswers) {
    if (!questionSet.has(a.questionId)) continue;
    if (isTeamOwnerKey(a.userId)) continue;

    let users = perQuestion.get(a.questionId);
    if (users === undefined) {
      users = new Map<string, boolean>();
      perQuestion.set(a.questionId, users);
    }
    users.set(a.userId, (users.get(a.userId) ?? false) || a.correct);
  }

  const userCounts = new Map<string, number>();

  for (const users of perQuestion.values()) {
    for (const [userId, isCorrect] of users) {
      if (isCorrect) {
        userCounts.set(userId, (userCounts.get(userId) ?? 0) + 1);
      }
    }
  }

  const sweepers = new Set<string>();
  for (const [userId, count] of userCounts) {
    if (count === questionIds.length) {
      sweepers.add(userId);
    }
  }

  return sweepers;
}

/**
 * Compute the per-fire round scoreboard — a per-player AGGREGATE, never
 * individual per-question responses.
 *
 * It is derived from the scored answers (the same source of truth as the
 * cumulative leaderboard), NOT from the reveal payload's `voters`. This keeps
 * it INDEPENDENT of `revealResponses`, which strictly governs per-question
 * display verbosity (who is named on each reveal) and has nothing to do with
 * the scoreboard. The scoreboard is shown every round regardless of mode.
 *
 * - `correct` counts revealed questions the player answered correctly.
 * - `answered` counts revealed questions the player submitted a scored answer
 *   to (correct or incorrect). Reactors-who-didn't-answer don't count.
 * - `points` sums each correctly-answered question's stamped worth via
 *   `questionPoints` (absent = 1), so it equals `correct` on a uniform fire.
 * - Cheaters/bot/pending rows are excluded UPSTREAM (caller filters with
 *   `isScoredAnswer`) — cheating handling is orthogonal to the reveal.
 * - Players with `answered === 0` are omitted.
 * - Sorted by `points` descending, then `displayName` ascending
 *   (case-insensitive, locale-sensitive comparison).
 * - `roundMvp: true` is set on every player tied for the highest `points`
 *   value, IFF that highest value is > 0.
 * - `perfectRound: true` is set on every player who answered all `totalQuestions`
 *   correctly, IFF the fire had at least `PERFECT_ROUND_MIN_QUESTIONS` questions
 *   (a sweep of a 1- or 2-question fire is not noteworthy). Weights play no part:
 *   perfection is about completeness, so on a weighted fire the MVP (top points)
 *   and the perfect player can be different people.
 */
export function computeRoundSummary(
  revealedQuestionIds: readonly string[],
  scoredAnswers: readonly RoundAnswer[],
  displayNameFor: (userId: string) => string,
  questionPoints: QuestionPointsMap,
): RoundSummary {
  const revealed = new Set(revealedQuestionIds);

  // Dedupe per (question, user) so a stray duplicate row can't double-count;
  // a question is "correct" for a user if any of their scored rows is correct.
  const perQuestion = new Map<string, Map<string, boolean>>();
  for (const a of scoredAnswers) {
    if (!revealed.has(a.questionId)) continue;
    // The round scoreboard is an INDIVIDUAL honor (MVP / perfect round) — teams are
    // credited in team standings, so synthetic `team:` rows never enter it.
    if (isTeamOwnerKey(a.userId)) continue;
    let users = perQuestion.get(a.questionId);
    if (users === undefined) {
      users = new Map<string, boolean>();
      perQuestion.set(a.questionId, users);
    }
    users.set(a.userId, (users.get(a.userId) ?? false) || a.correct);
  }

  const byUser = new Map<string, { correct: number; answered: number; points: number }>();
  for (const [questionId, users] of perQuestion) {
    const worth = questionPoints.get(questionId) ?? 1;
    for (const [userId, isCorrect] of users) {
      const tally = byUser.get(userId) ?? { correct: 0, answered: 0, points: 0 };
      tally.answered += 1;
      if (isCorrect) {
        tally.correct += 1;
        tally.points += worth;
      }
      byUser.set(userId, tally);
    }
  }

  const base = [...byUser.entries()]
    .map(([userId, { correct, answered, points }]) => ({
      userId,
      displayName: displayNameFor(userId),
      correct,
      answered,
      points,
    }))
    .sort((a, b) => {
      if (a.points !== b.points) return b.points - a.points;
      return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" });
    });

  const totalQuestions = revealedQuestionIds.length;
  const topPoints = base.reduce((max, e) => Math.max(max, e.points), 0);
  const perfects = perfectRoundSweepers(revealedQuestionIds, scoredAnswers);

  const perPlayer: RoundSummaryEntry[] = base.map((e) => ({
    ...e,
    ...(topPoints > 0 && e.points === topPoints ? { roundMvp: true } : {}),
    ...(perfects.has(e.userId) ? { perfectRound: true } : {}),
  }));

  return { totalQuestions, perPlayer };
}

/**
 * Tally perfect rounds across an entire season and identify the champion(s).
 * Groups questions by `batchId` (or singleton for undefined batchId), computes
 * the perfect-round sweepers for each fire, and tallies wins per user. Returns
 * the user(s) with the maximum tally, or `null` if nobody swept any fire.
 */
export function aggregateSeasonPerfectRounds(
  revealedSeasonQuestions: readonly { id: string; batchId?: string }[],
  scoredSeasonAnswers: readonly RoundAnswer[],
): PerfectRoundsChampion | null {
  const groups = new Map<
    string,
    { key: string; questions: Array<{ id: string; batchId?: string }> }
  >();

  for (const q of revealedSeasonQuestions) {
    const key = batchKeyOf(q);
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, { key, questions: [q] });
    } else {
      existing.questions.push(q);
    }
  }

  const perfectCounts = new Map<string, number>();

  for (const { questions } of groups.values()) {
    const questionIds = questions.map((q) => q.id);
    const sweepers = perfectRoundSweepers(questionIds, scoredSeasonAnswers);
    for (const userId of sweepers) {
      perfectCounts.set(userId, (perfectCounts.get(userId) ?? 0) + 1);
    }
  }

  const countValues = [...perfectCounts.values()];
  const maxCount = countValues.length > 0 ? Math.max(...countValues) : 0;
  if (maxCount === 0) {
    return null;
  }

  const champions = [...perfectCounts.entries()]
    .filter(([, count]) => count === maxCount)
    .map(([userId]) => userId)
    .sort();

  return {
    userIds: champions,
    count: maxCount,
  };
}
