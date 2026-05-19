import type { ProcessRevealEntry, RoundSummary, RoundSummaryEntry } from "./types.js";

/**
 * Compute the per-fire round summary from a list of `ProcessRevealEntry`s.
 *
 * - `correct` counts reveals where the player appears in `voters.correct`.
 * - `answered` counts reveals where the player appears in ANY voter bucket
 *   (correct, incorrect, fenceSitters, wildcards).
 * - Players with `answered === 0` are omitted (only present-in-payload players
 *   are tracked; cheaters / multi-react voters / the bot are already excluded
 *   structurally from `voters` by `process_reveal_answers`).
 * - Sorted by `correct` descending, then `displayName` ascending (case-insensitive,
 *   locale-sensitive comparison).
 * - `roundMvp: true` is set on every player tied for the highest `correct` value
 *   in the result, IFF that highest value is > 0.
 */
export function computeRoundSummary(reveals: ProcessRevealEntry[]): RoundSummary {
  const byUser = new Map<string, { displayName: string; correct: number; answered: number }>();
  const seenInThisReveal = new Set<string>();

  for (const reveal of reveals) {
    seenInThisReveal.clear();
    const { correct, incorrect, fenceSitters, wildcards } = reveal.voters;

    const noteAnswered = (userId: string, displayName: string): void => {
      const existing = byUser.get(userId);
      if (existing === undefined) {
        byUser.set(userId, { displayName, correct: 0, answered: 1 });
      } else if (!seenInThisReveal.has(userId)) {
        existing.answered += 1;
      }
      seenInThisReveal.add(userId);
    };

    for (const v of correct) {
      noteAnswered(v.userId, v.displayName);
      const entry = byUser.get(v.userId);
      if (entry !== undefined) entry.correct += 1;
    }
    for (const v of incorrect) noteAnswered(v.userId, v.displayName);
    for (const v of fenceSitters) noteAnswered(v.userId, v.displayName);
    for (const v of wildcards) noteAnswered(v.userId, v.displayName);
  }

  const entries: RoundSummaryEntry[] = [];
  for (const [userId, { displayName, correct, answered }] of byUser) {
    entries.push({ userId, displayName, correct, answered });
  }

  entries.sort((a, b) => {
    if (a.correct !== b.correct) return b.correct - a.correct;
    return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" });
  });

  let topCorrect = 0;
  for (const e of entries) {
    if (e.correct > topCorrect) topCorrect = e.correct;
  }
  if (topCorrect > 0) {
    for (const e of entries) {
      if (e.correct === topCorrect) e.roundMvp = true;
    }
  }

  return { totalQuestions: reveals.length, perPlayer: entries };
}
