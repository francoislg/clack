/**
 * Cheater-filter helpers for reveal-time handlers. Cheats are not scored,
 * never surface in voter buckets, and never appear in reaction commentary —
 * but their `answers.json` rows stay on disk so the audit trail survives.
 * This module centralizes the three places that filter happens.
 */

import type { ScopedTriviaDataLayer, SubmittedAnswer } from "../core/types.js";

/** Load the set of cheater userIds flagged for this question. */
export async function loadQuestionCheaterIds(
  scoped: ScopedTriviaDataLayer,
  questionId: string,
): Promise<Set<string>> {
  const cheats = await scoped.loadCheats();
  return new Set(cheats.filter((c) => c.questionId === questionId).map((c) => c.cheaterUserId));
}

/**
 * Combine the supplied `cheaterIds` plus the bot user (when configured) into
 * the single exclude set the bucket builders consume. Centralized so each
 * handler doesn't repeat the "skip empty bot user id" guard.
 */
export function buildExcludeSet(botUserId: string, cheaterIds: ReadonlySet<string>): Set<string> {
  const excludes = new Set<string>(cheaterIds);
  if (botUserId.length > 0) excludes.add(botUserId);
  return excludes;
}

/**
 * Whether a SubmittedAnswer row should be counted in scored voter buckets.
 * Excludes cheaters, the bot, and pre-judge (pending) freeform rows.
 */
export function isScoredAnswer(
  answer: SubmittedAnswer,
  cheaterIds: ReadonlySet<string>,
  botUserId: string,
): boolean {
  if (cheaterIds.has(answer.userId)) return false;
  if (botUserId.length > 0 && answer.userId === botUserId) return false;
  if (answer.correct === undefined) return false; // pending (pre-judge) — skip
  return true;
}
