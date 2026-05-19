import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  cleanReactionLists,
  indexUsersToEmojis,
  makeVoter,
  makeWildcardVoter,
  isNumberedReaction,
  categorizeBoolean,
  categorizeChoice,
} from "./categorize.js";
import type { SlackReactionLike } from "./types.js";
import type { TriviaUser } from "../../core/types.js";

function user(id: string, displayName: string): [string, TriviaUser] {
  return [id, { userId: id, displayName, joinedAt: 0 }];
}

describe("cleanReactionLists", () => {
  it("strips the bot user from every reaction", () => {
    const input: SlackReactionLike[] = [
      { emoji: "+1", users: ["B", "U1"] },
      { emoji: "-1", users: ["B"] },
    ];
    assert.deepEqual(cleanReactionLists(input, "B", new Set()), [
      { emoji: "+1", users: ["U1"] },
      { emoji: "-1", users: [] },
    ]);
  });

  it("strips cheaters from every reaction", () => {
    const input: SlackReactionLike[] = [
      { emoji: "+1", users: ["U1", "C1"] },
      { emoji: "tada", users: ["C2", "C1"] },
    ];
    assert.deepEqual(cleanReactionLists(input, "", new Set(["C1", "C2"])), [
      { emoji: "+1", users: ["U1"] },
      { emoji: "tada", users: [] },
    ]);
  });

  it("strips both bot and cheaters in one pass", () => {
    const input: SlackReactionLike[] = [{ emoji: "+1", users: ["B", "U1", "C1", "U2"] }];
    assert.deepEqual(cleanReactionLists(input, "B", new Set(["C1"])), [
      { emoji: "+1", users: ["U1", "U2"] },
    ]);
  });

  it("returns a new array; does not mutate input", () => {
    const input: SlackReactionLike[] = [{ emoji: "+1", users: ["U1", "B"] }];
    const out = cleanReactionLists(input, "B", new Set());
    assert.notEqual(out, input);
    assert.deepEqual(input[0].users, ["U1", "B"]);
  });
});

describe("indexUsersToEmojis", () => {
  it("builds a user-to-emojis map", () => {
    const input: SlackReactionLike[] = [
      { emoji: "+1", users: ["U1", "U2"] },
      { emoji: "-1", users: ["U2", "U3"] },
      { emoji: "tada", users: ["U1"] },
    ];
    const index = indexUsersToEmojis(input);
    assert.deepEqual([...(index.get("U1") ?? [])], ["+1", "tada"]);
    assert.deepEqual([...(index.get("U2") ?? [])], ["+1", "-1"]);
    assert.deepEqual([...(index.get("U3") ?? [])], ["-1"]);
  });

  it("returns an empty map on empty input", () => {
    assert.equal(indexUsersToEmojis([]).size, 0);
  });
});

describe("makeVoter / makeWildcardVoter", () => {
  it("uses the user's displayName when known", () => {
    const users = new Map([user("U1", "Alice")]);
    assert.deepEqual(makeVoter("U1", users), { userId: "U1", displayName: "Alice" });
  });

  it("falls back to the userId as displayName when unknown", () => {
    assert.deepEqual(makeVoter("U_unknown", new Map()), {
      userId: "U_unknown",
      displayName: "U_unknown",
    });
  });

  it("wildcard voter carries the emoji", () => {
    const users = new Map([user("U1", "Alice")]);
    assert.deepEqual(makeWildcardVoter("U1", "pizza", users), {
      userId: "U1",
      displayName: "Alice",
      emoji: "pizza",
    });
  });
});

describe("isNumberedReaction", () => {
  it("matches one/two/three/four", () => {
    assert.equal(isNumberedReaction("one"), true);
    assert.equal(isNumberedReaction("two"), true);
    assert.equal(isNumberedReaction("three"), true);
    assert.equal(isNumberedReaction("four"), true);
  });

  it("rejects other emojis", () => {
    assert.equal(isNumberedReaction("+1"), false);
    assert.equal(isNumberedReaction("ONE"), false);
    assert.equal(isNumberedReaction("five"), false);
    assert.equal(isNumberedReaction(""), false);
  });
});

describe("categorizeBoolean", () => {
  it("buckets a correct :+1: vote under correct (isTrue=true)", () => {
    const reactions: SlackReactionLike[] = [{ emoji: "+1", users: ["U1"] }];
    const users = new Map([user("U1", "Alice")]);
    const { buckets, scored } = categorizeBoolean(reactions, true, users);
    assert.deepEqual(buckets.correct, [{ userId: "U1", displayName: "Alice" }]);
    assert.deepEqual(buckets.incorrect, []);
    assert.deepEqual(buckets.fenceSitters, []);
    assert.deepEqual(buckets.wildcards, []);
    assert.deepEqual(scored, [{ userId: "U1", answer: true }]);
  });

  it("buckets a :-1: vote under correct when isTrue=false", () => {
    const reactions: SlackReactionLike[] = [{ emoji: "-1", users: ["U1"] }];
    const { buckets, scored } = categorizeBoolean(reactions, false, new Map());
    assert.deepEqual(
      buckets.correct.map((v) => v.userId),
      ["U1"],
    );
    assert.equal(buckets.incorrect.length, 0);
    assert.deepEqual(scored, [{ userId: "U1", answer: false }]);
  });

  it("buckets a wrong vote under incorrect", () => {
    const reactions: SlackReactionLike[] = [{ emoji: "-1", users: ["U1"] }];
    const { buckets } = categorizeBoolean(reactions, true, new Map());
    assert.equal(buckets.correct.length, 0);
    assert.deepEqual(
      buckets.incorrect.map((v) => v.userId),
      ["U1"],
    );
  });

  it("treats a user with both :+1: and :-1: as a fence-sitter (not scored)", () => {
    const reactions: SlackReactionLike[] = [
      { emoji: "+1", users: ["U1"] },
      { emoji: "-1", users: ["U1"] },
    ];
    const { buckets, scored } = categorizeBoolean(reactions, true, new Map());
    assert.deepEqual(
      buckets.fenceSitters.map((v) => v.userId),
      ["U1"],
    );
    assert.equal(scored.length, 0);
    assert.equal(buckets.correct.length, 0);
    assert.equal(buckets.incorrect.length, 0);
  });

  it("buckets a non-boolean reaction as a wildcard with emoji captured", () => {
    const reactions: SlackReactionLike[] = [{ emoji: "pizza", users: ["U1"] }];
    const { buckets, scored } = categorizeBoolean(reactions, true, new Map());
    assert.equal(scored.length, 0);
    assert.equal(buckets.wildcards.length, 1);
    assert.equal(buckets.wildcards[0].userId, "U1");
    assert.equal(buckets.wildcards[0].emoji, "pizza");
  });

  it("accepts the `thumbsup` / `thumbsdown` synonyms", () => {
    const reactions: SlackReactionLike[] = [
      { emoji: "thumbsup", users: ["U1"] },
      { emoji: "thumbsdown", users: ["U2"] },
    ];
    const { scored } = categorizeBoolean(reactions, true, new Map());
    assert.deepEqual(
      scored.sort((a, b) => a.userId.localeCompare(b.userId)),
      [
        { userId: "U1", answer: true },
        { userId: "U2", answer: false },
      ],
    );
  });

  it("handles many voters across mixed buckets", () => {
    const reactions: SlackReactionLike[] = [
      { emoji: "+1", users: ["U1", "U2", "U3"] }, // U3 also gets a -1 below → fence-sitter
      { emoji: "-1", users: ["U3", "U4"] },
      { emoji: "pizza", users: ["U5"] },
    ];
    const { buckets, scored } = categorizeBoolean(reactions, true, new Map());
    assert.deepEqual(buckets.correct.map((v) => v.userId).sort(), ["U1", "U2"]);
    assert.deepEqual(
      buckets.incorrect.map((v) => v.userId),
      ["U4"],
    );
    assert.deepEqual(
      buckets.fenceSitters.map((v) => v.userId),
      ["U3"],
    );
    assert.deepEqual(
      buckets.wildcards.map((v) => v.userId),
      ["U5"],
    );
    assert.equal(scored.length, 3); // U1, U2, U4
  });
});

describe("categorizeChoice", () => {
  it("buckets a correct numbered vote under correct", () => {
    const reactions: SlackReactionLike[] = [{ emoji: "three", users: ["U1"] }];
    const users = new Map([user("U1", "Alice")]);
    const { buckets, scored } = categorizeChoice(reactions, 2, users);
    assert.deepEqual(buckets.correct, [{ userId: "U1", displayName: "Alice" }]);
    assert.deepEqual(scored, [{ userId: "U1", answerIndex: 2 }]);
  });

  it("buckets a wrong numbered vote under incorrect", () => {
    const reactions: SlackReactionLike[] = [{ emoji: "one", users: ["U1"] }];
    const { buckets, scored } = categorizeChoice(reactions, 2, new Map());
    assert.equal(buckets.incorrect.length, 1);
    assert.equal(buckets.correct.length, 0);
    assert.deepEqual(scored, [{ userId: "U1", answerIndex: 0 }]);
  });

  it("silently voids multi-react voters (2+ numbered emojis)", () => {
    const reactions: SlackReactionLike[] = [
      { emoji: "one", users: ["U1"] },
      { emoji: "two", users: ["U1"] },
    ];
    const { buckets, scored } = categorizeChoice(reactions, 0, new Map());
    // U1 voted for one AND two — silently voided. Appears in NO bucket and is NOT scored.
    assert.equal(buckets.correct.length, 0);
    assert.equal(buckets.incorrect.length, 0);
    assert.equal(buckets.wildcards.length, 0);
    assert.equal(buckets.fenceSitters.length, 0);
    assert.equal(scored.length, 0);
  });

  it("fenceSitters is always empty for choice questions", () => {
    const reactions: SlackReactionLike[] = [
      { emoji: "one", users: ["U1"] },
      { emoji: "+1", users: ["U2"] },
    ];
    const { buckets } = categorizeChoice(reactions, 0, new Map());
    assert.deepEqual(buckets.fenceSitters, []);
  });

  it("non-numbered reactions land in wildcards with emoji captured", () => {
    const reactions: SlackReactionLike[] = [{ emoji: "pizza", users: ["U1"] }];
    const { buckets, scored } = categorizeChoice(reactions, 0, new Map());
    assert.equal(scored.length, 0);
    assert.equal(buckets.wildcards.length, 1);
    assert.equal(buckets.wildcards[0].emoji, "pizza");
  });

  it("maps numbered emojis to indices: one→0, two→1, three→2, four→3", () => {
    const reactions: SlackReactionLike[] = [
      { emoji: "one", users: ["U1"] },
      { emoji: "two", users: ["U2"] },
      { emoji: "three", users: ["U3"] },
      { emoji: "four", users: ["U4"] },
    ];
    const { scored } = categorizeChoice(reactions, 0, new Map());
    assert.deepEqual(
      scored.sort((a, b) => a.userId.localeCompare(b.userId)),
      [
        { userId: "U1", answerIndex: 0 },
        { userId: "U2", answerIndex: 1 },
        { userId: "U3", answerIndex: 2 },
        { userId: "U4", answerIndex: 3 },
      ],
    );
  });

  it("a user with one numbered emoji + one non-numbered reaction is scored (not voided)", () => {
    const reactions: SlackReactionLike[] = [
      { emoji: "one", users: ["U1"] },
      { emoji: "pizza", users: ["U1"] },
    ];
    const { buckets, scored } = categorizeChoice(reactions, 0, new Map());
    // Only one numbered emoji → scored as a regular vote. Wildcard pizza is ignored for this user.
    assert.equal(scored.length, 1);
    assert.equal(scored[0].answerIndex, 0);
    assert.equal(buckets.correct.length, 1);
    assert.equal(buckets.wildcards.length, 0);
  });
});
