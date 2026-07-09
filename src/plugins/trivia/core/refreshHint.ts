/**
 * Uniform repaint-hint builders shared by every content-mutating trivia tool, so each
 * mutator points Claude at the SAME repaint path with identical wording (never a batchId).
 */

/** The exact `refresh_question_cards` call that repaints the named card. */
export function repaintHint(questionId: string): string {
  return `refresh_question_cards(game, questionIds: ["${questionId}"])`;
}

/**
 * For mutations that change scored verdicts (override, cheat removal, re-settle): the card
 * is only accurate after the answers are re-derived, so the repaint follows a reprocess.
 */
export function reprocessThenRepaintHint(questionId: string): string {
  return `Run compute_answers (reprocess this question), then repaint with ${repaintHint(questionId)}.`;
}
