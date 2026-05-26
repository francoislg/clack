/**
 * Reactor-side voter computations: build the per-user reaction index from a
 * Slack `reactions[*]` array, materialize the commentary list, and project
 * "reacted but didn't answer" into the `noAnswer` bucket. Pure functions —
 * no I/O — each one takes its inputs and emits a stable shape.
 */

import type { TriviaUser } from "../core/types.js";
import type { ReactorEntry, SlackReactionLike, Voter } from "../tools/reveal/types.js";

/**
 * Build a per-user reaction index: `userId → { emojis they reacted with }`.
 * Filters out the supplied excludeIds (bot + cheaters) before indexing.
 */
export function buildReactorIndex(
  reactions: SlackReactionLike[],
  excludeIds: ReadonlySet<string>,
): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const r of reactions) {
    for (const u of r.users) {
      if (excludeIds.has(u)) continue;
      let set = index.get(u);
      if (set === undefined) {
        set = new Set<string>();
        index.set(u, set);
      }
      set.add(r.emoji);
    }
  }
  return index;
}

/** Build the reactor commentary list from a reactor index. */
export function buildReactionsList(
  reactorIndex: ReadonlyMap<string, ReadonlySet<string>>,
  users: ReadonlyMap<string, TriviaUser>,
): ReactorEntry[] {
  return [...reactorIndex.entries()].map(([userId, emojis]) => ({
    userId,
    displayName: users.get(userId)?.displayName ?? userId,
    emojis: [...emojis],
  }));
}

/**
 * Build the `noAnswer` bucket: reactors who didn't submit a button answer.
 * The caller passes the set of userIds that DID submit (gathered while
 * partitioning correct/incorrect), so this helper just iterates the reactor
 * index and emits voters for the leftovers.
 */
export function buildNoAnswerBucket(
  reactorIndex: ReadonlyMap<string, ReadonlySet<string>>,
  answeredUserIds: ReadonlySet<string>,
  users: ReadonlyMap<string, TriviaUser>,
): Voter[] {
  const noAnswer: Voter[] = [];
  for (const userId of reactorIndex.keys()) {
    if (answeredUserIds.has(userId)) continue;
    noAnswer.push({
      userId,
      displayName: users.get(userId)?.displayName ?? userId,
    });
  }
  return noAnswer;
}
