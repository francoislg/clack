import type { ProcessRevealEntry, RoundSummary, RoundSummaryEntry } from "./types.js";

/**
 * Compute the per-fire round summary from a list of `ProcessRevealEntry`s.
 *
 * - `correct` counts reveals where the player appears in `voters.correct`.
 * - `answered` counts reveals where the player appears in either `correct`
 *   or `incorrect` (named-bucket presence). The `noAnswer` and `reactions`
 *   buckets track reactor-only participation and don't count as "answered."
 * - Reveal entries whose `voters.revealResponses` is `"no"` or `"just-winners"`
 *   carry no `incorrect` named bucket — they contribute zero to every player's
 *   tallies (which is the point of the restricted modes; we don't have the
 *   per-player data to tally). These batches never surface the summary anyway.
 * - Players with `answered === 0` are omitted from the result.
 * - Sorted by `correct` descending, then `displayName` ascending
 *   (case-insensitive, locale-sensitive comparison).
 * - `roundMvp: true` is set on every player tied for the highest `correct`
 *   value in the result, IFF that highest value is > 0.
 *
 * Callers gate the field's presence on the result: the round summary should
 * only be surfaced when ALL reveal entries in the batch are
 * `revealResponses === "yes"` (mixed-mode batches lose the field entirely).
 */
export function computeRoundSummary(reveals: ProcessRevealEntry[]): RoundSummary {
  const byUser = new Map<string, { displayName: string; correct: number; answered: number }>();
  const seenInThisReveal = new Set<string>();

  for (const reveal of reveals) {
    seenInThisReveal.clear();
    const buckets = reveal.voters;
    if (buckets.revealResponses === "no" || buckets.revealResponses === "just-winners") continue;
    const { correct, incorrect } = buckets;

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
