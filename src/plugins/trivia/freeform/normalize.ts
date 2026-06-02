import type { TriviaQuestion } from "../core/types.js";

/**
 * Maximally conservative normalization for the reveal-time exact-match pre-check.
 * Trims, lowercases, and collapses internal whitespace runs to a single space —
 * nothing else. Punctuation is NOT removed and accents are NOT folded, so the
 * pre-check stays a strict SUBSET of what the model judge would accept: two
 * strings can only normalize equal when they are the same answer. (Stripping
 * punctuation would wrongly fold `C` into `C++` or `5` into `$5`; folding accents
 * would fold `cafe` into `café`.)
 */
export function normalizeAnswer(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * True when the player's `answerText` normalizes equal to the question's
 * `expectedAnswer` or to any entry in `acceptableAnswers`. A match means the
 * answer is unambiguously correct by string equality, so `judgeAnswer` can
 * accept it without invoking the model judge.
 */
export function isExactMatch(question: TriviaQuestion, answerText: string): boolean {
  const normalized = normalizeAnswer(answerText);
  if (
    question.expectedAnswer !== undefined &&
    normalizeAnswer(question.expectedAnswer) === normalized
  ) {
    return true;
  }
  for (const variant of question.acceptableAnswers ?? []) {
    if (normalizeAnswer(variant) === normalized) return true;
  }
  return false;
}
