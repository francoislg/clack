import type { TriviaQuestion, SubmittedAnswer } from "../core/types.js";

/**
 * Extract question IDs that are currently pending (posted but not yet processed).
 * A pending question has `postedAt` set but `processedAt` undefined.
 *
 * @param questions - All questions in the game
 * @returns Array of question IDs that are pending
 */
export function pendingQuestionIds(questions: TriviaQuestion[]): string[] {
  return questions
    .filter((q) => q.postedAt !== undefined && q.processedAt === undefined)
    .map((q) => q.id);
}

/**
 * Extract the set of user IDs who have answered any of the pending questions.
 * Excludes synthetic team rows (userId starting with "team:").
 *
 * @param answers - All submitted answers
 * @param pendingIds - Question IDs currently pending
 * @returns Set of user IDs who answered at least one pending question
 */
export function answeredUserIds(answers: SubmittedAnswer[], pendingIds: string[]): Set<string> {
  const pendingSet = new Set(pendingIds);
  const answered = new Set<string>();

  for (const answer of answers) {
    if (pendingSet.has(answer.questionId) && !answer.userId.startsWith("team:")) {
      answered.add(answer.userId);
    }
  }

  return answered;
}

/**
 * Filter candidate user IDs to those who have not answered any pending question.
 * Preserves the order of the input candidate list.
 *
 * @param candidateUserIds - User IDs to filter (typically all users in the game)
 * @param answered - Set of user IDs who have answered (from answeredUserIds)
 * @returns Ordered array of user IDs who have not answered
 */
export function unplayedCandidates(candidateUserIds: string[], answered: Set<string>): string[] {
  return candidateUserIds.filter((userId) => !answered.has(userId));
}
