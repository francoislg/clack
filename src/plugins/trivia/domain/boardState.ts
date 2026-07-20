import type { TriviaQuestion } from "../core/types.js";

/**
 * Whether any posted question is still awaiting its reveal. The single
 * definition of "the board is NOT cleared" — shared by `compute_answers`'
 * wind-down eligibility report and `end_season`'s seasonless guard so the two
 * can never drift.
 */
export function hasUnrevealedPostedQuestions(questions: readonly TriviaQuestion[]): boolean {
  return questions.some((q) => q.postedAt !== undefined && q.processedAt === undefined);
}
