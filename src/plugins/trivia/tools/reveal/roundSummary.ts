import type { RoundSummary, RoundSummaryEntry } from "./types.js";

/** Minimum question count for a clean sweep to earn `perfectRound`. */
export const PERFECT_ROUND_MIN_QUESTIONS = 3;

/** One scored answer to a revealed question — already cheater/bot/pending-filtered by the caller. */
export interface RoundAnswer {
  questionId: string;
  userId: string;
  correct: boolean;
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
 * - Cheaters/bot/pending rows are excluded UPSTREAM (caller filters with
 *   `isScoredAnswer`) — cheating handling is orthogonal to the reveal.
 * - Players with `answered === 0` are omitted.
 * - Sorted by `correct` descending, then `displayName` ascending
 *   (case-insensitive, locale-sensitive comparison).
 * - `roundMvp: true` is set on every player tied for the highest `correct`
 *   value, IFF that highest value is > 0.
 * - `perfectRound: true` is set on every player who answered all `totalQuestions`
 *   correctly, IFF the fire had at least `PERFECT_ROUND_MIN_QUESTIONS` questions
 *   (a sweep of a 1- or 2-question fire is not noteworthy).
 */
export function computeRoundSummary(
  revealedQuestionIds: readonly string[],
  scoredAnswers: readonly RoundAnswer[],
  displayNameFor: (userId: string) => string,
): RoundSummary {
  const revealed = new Set(revealedQuestionIds);

  // Dedupe per (question, user) so a stray duplicate row can't double-count;
  // a question is "correct" for a user if any of their scored rows is correct.
  const perQuestion = new Map<string, Map<string, boolean>>();
  for (const a of scoredAnswers) {
    if (!revealed.has(a.questionId)) continue;
    let users = perQuestion.get(a.questionId);
    if (users === undefined) {
      users = new Map<string, boolean>();
      perQuestion.set(a.questionId, users);
    }
    users.set(a.userId, (users.get(a.userId) ?? false) || a.correct);
  }

  const byUser = new Map<string, { correct: number; answered: number }>();
  for (const users of perQuestion.values()) {
    for (const [userId, isCorrect] of users) {
      const tally = byUser.get(userId) ?? { correct: 0, answered: 0 };
      tally.answered += 1;
      if (isCorrect) tally.correct += 1;
      byUser.set(userId, tally);
    }
  }

  const base = [...byUser.entries()]
    .map(([userId, { correct, answered }]) => ({
      userId,
      displayName: displayNameFor(userId),
      correct,
      answered,
    }))
    .sort((a, b) => {
      if (a.correct !== b.correct) return b.correct - a.correct;
      return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" });
    });

  const totalQuestions = revealedQuestionIds.length;
  const topCorrect = base.reduce((max, e) => Math.max(max, e.correct), 0);
  const perfectEligible = totalQuestions >= PERFECT_ROUND_MIN_QUESTIONS;

  const perPlayer: RoundSummaryEntry[] = base.map((e) => ({
    ...e,
    ...(topCorrect > 0 && e.correct === topCorrect ? { roundMvp: true } : {}),
    ...(perfectEligible && e.correct === totalQuestions ? { perfectRound: true } : {}),
  }));

  return { totalQuestions, perPlayer };
}
