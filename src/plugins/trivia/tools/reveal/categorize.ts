import type { SlackReactionLike, Voter, VoterBuckets, WildcardVoter } from "./types.js";
import type { TriviaUser } from "../../core/types.js";

/** Slack reaction names that map to numbered-choice indices (0..3). */
export const NUMBERED_REACTION_INDEX: { one: 0; two: 1; three: 2; four: 3 } = {
  one: 0,
  two: 1,
  three: 2,
  four: 3,
};

/** Reaction names that signal a boolean vote. */
export const THUMBS_UP_REACTIONS: ReadonlySet<string> = new Set(["+1", "thumbsup"]);
export const THUMBS_DOWN_REACTIONS: ReadonlySet<string> = new Set(["-1", "thumbsdown"]);

/** Strip the bot + every flagged cheater from the user lists on each reaction. */
export function cleanReactionLists(
  reactions: SlackReactionLike[],
  botUserId: string,
  cheaterIds: Set<string>,
): SlackReactionLike[] {
  return reactions.map((r) => ({
    emoji: r.emoji,
    users: r.users.filter((u) => u !== botUserId && !cheaterIds.has(u)),
  }));
}

/**
 * Build a per-user index: `userId -> { reaction names this user used }`.
 * Used by both boolean and choice categorization to decide multi-react / fence-sit
 * states purely from set membership.
 */
export function indexUsersToEmojis(reactions: SlackReactionLike[]): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const r of reactions) {
    for (const u of r.users) {
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

export function makeVoter(userId: string, users: Map<string, TriviaUser>): Voter {
  const user = users.get(userId);
  return {
    userId,
    displayName: user?.displayName ?? userId,
  };
}

export function makeWildcardVoter(
  userId: string,
  emoji: string,
  users: Map<string, TriviaUser>,
): WildcardVoter {
  return {
    ...makeVoter(userId, users),
    emoji,
  };
}

export function isNumberedReaction(emoji: string): emoji is "one" | "two" | "three" | "four" {
  return emoji === "one" || emoji === "two" || emoji === "three" || emoji === "four";
}

/**
 * Categorize voters on a boolean question.
 *
 * Returns categorized buckets AND the SCORED users (those who cast a single boolean
 * vote — `:+1:` xor `:-1:`). Fence-sitters and wildcards do not score.
 */
export function categorizeBoolean(
  reactions: SlackReactionLike[],
  isTrue: boolean,
  users: Map<string, TriviaUser>,
): { buckets: VoterBuckets; scored: Array<{ userId: string; answer: boolean }> } {
  const index = indexUsersToEmojis(reactions);
  const buckets: VoterBuckets = {
    correct: [],
    incorrect: [],
    fenceSitters: [],
    wildcards: [],
  };
  const scored: Array<{ userId: string; answer: boolean }> = [];

  for (const [userId, emojis] of index) {
    const votedTrue = [...emojis].some((e) => THUMBS_UP_REACTIONS.has(e));
    const votedFalse = [...emojis].some((e) => THUMBS_DOWN_REACTIONS.has(e));

    if (votedTrue && votedFalse) {
      buckets.fenceSitters.push(makeVoter(userId, users));
      continue;
    }
    if (votedTrue || votedFalse) {
      const userAnswer = votedTrue;
      scored.push({ userId, answer: userAnswer });
      const voter = makeVoter(userId, users);
      if (userAnswer === isTrue) buckets.correct.push(voter);
      else buckets.incorrect.push(voter);
      continue;
    }
    const firstEmoji = [...emojis][0] ?? "";
    buckets.wildcards.push(makeWildcardVoter(userId, firstEmoji, users));
  }

  return { buckets, scored };
}

/**
 * Categorize voters on a choice question.
 *
 * Users who reacted with 2+ numbered emojis are SILENTLY VOIDED — they appear in
 * no bucket (the spec requires they be structurally absent from the renderer payload).
 * Users with 0 numbered emojis (but ≥1 reaction) land in wildcards.
 */
export function categorizeChoice(
  reactions: SlackReactionLike[],
  correctIndex: number,
  users: Map<string, TriviaUser>,
): {
  buckets: VoterBuckets;
  scored: Array<{ userId: string; answerIndex: number }>;
} {
  const index = indexUsersToEmojis(reactions);
  const buckets: VoterBuckets = {
    correct: [],
    incorrect: [],
    fenceSitters: [],
    wildcards: [],
  };
  const scored: Array<{ userId: string; answerIndex: number }> = [];

  for (const [userId, emojis] of index) {
    const numbered = [...emojis].filter(isNumberedReaction);
    if (numbered.length >= 2) {
      // Multi-react — silently voided.
      continue;
    }
    if (numbered.length === 1) {
      const answerIndex = NUMBERED_REACTION_INDEX[numbered[0]];
      scored.push({ userId, answerIndex });
      const voter = makeVoter(userId, users);
      if (answerIndex === correctIndex) buckets.correct.push(voter);
      else buckets.incorrect.push(voter);
      continue;
    }
    const firstEmoji = [...emojis][0] ?? "";
    buckets.wildcards.push(makeWildcardVoter(userId, firstEmoji, users));
  }

  return { buckets, scored };
}
