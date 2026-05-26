import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { computeRoundSummary } from "./roundSummary.js";
import type { ProcessRevealEntry, Voter } from "./types.js";

function voter(userId: string, displayName = userId): Voter {
  return { userId, displayName };
}

function reveal(
  questionId: string,
  correct: Voter[],
  incorrect: Voter[] = [],
  noAnswer: Voter[] = [],
): ProcessRevealEntry {
  return {
    questionId,
    statement: `S-${questionId}`,
    category: "X",
    emojis: ["❓"],
    messageLink: "https://example.com",
    wasReprocessed: false,
    answer: { type: "boolean", isTrue: true },
    voters: {
      revealResponses: "yes",
      correct,
      incorrect,
      noAnswer,
      reactions: [],
    },
  };
}

describe("computeRoundSummary", () => {
  it("returns empty result for zero reveals", () => {
    const out = computeRoundSummary([]);
    assert.equal(out.totalQuestions, 0);
    assert.deepEqual(out.perPlayer, []);
  });

  it("length-1 single-voter result", () => {
    const out = computeRoundSummary([reveal("q1", [voter("alice", "Alice")])]);
    assert.equal(out.totalQuestions, 1);
    assert.equal(out.perPlayer.length, 1);
    assert.equal(out.perPlayer[0].userId, "alice");
    assert.equal(out.perPlayer[0].correct, 1);
    assert.equal(out.perPlayer[0].answered, 1);
    assert.equal(out.perPlayer[0].roundMvp, true);
  });

  it("length-3 aggregation example from spec", () => {
    // alice: correct on Q1+Q2, incorrect on Q3 → 2/3
    // bob: correct on Q1, didn't vote Q2, correct on Q3 → 2/2
    // carol: correct on all three → 3/3
    const reveals = [
      reveal("q1", [voter("alice", "Alice"), voter("bob", "Bob"), voter("carol", "Carol")]),
      reveal("q2", [voter("alice", "Alice"), voter("carol", "Carol")]),
      reveal("q3", [voter("bob", "Bob"), voter("carol", "Carol")], [voter("alice", "Alice")]),
    ];
    const out = computeRoundSummary(reveals);
    assert.equal(out.totalQuestions, 3);

    const byId = new Map(out.perPlayer.map((p) => [p.userId, p]));
    assert.equal(byId.get("alice")?.correct, 2);
    assert.equal(byId.get("alice")?.answered, 3);
    assert.equal(byId.get("alice")?.roundMvp, undefined);

    assert.equal(byId.get("bob")?.correct, 2);
    assert.equal(byId.get("bob")?.answered, 2);
    assert.equal(byId.get("bob")?.roundMvp, undefined);

    assert.equal(byId.get("carol")?.correct, 3);
    assert.equal(byId.get("carol")?.answered, 3);
    assert.equal(byId.get("carol")?.roundMvp, true);
  });

  it("multiple MVPs when tied at the top", () => {
    const reveals = [
      reveal("q1", [voter("alice", "Alice"), voter("bob", "Bob")]),
      reveal("q2", [voter("alice", "Alice"), voter("bob", "Bob")]),
    ];
    const out = computeRoundSummary(reveals);
    assert.equal(out.perPlayer.filter((p) => p.roundMvp).length, 2);
  });

  it("no MVPs when nobody scored correct", () => {
    const reveals = [
      reveal("q1", [], [voter("alice", "Alice")]),
      reveal("q2", [], [voter("alice", "Alice"), voter("bob", "Bob")]),
    ];
    const out = computeRoundSummary(reveals);
    assert.equal(out.perPlayer.length, 2);
    assert.equal(
      out.perPlayer.filter((p) => p.roundMvp).length,
      0,
      "no roundMvp on zero-correct entries",
    );
  });

  it("players with answered: 0 are omitted (only present-in-payload players tracked)", () => {
    // dave is never in any reveal's voter list
    const reveals = [reveal("q1", [voter("alice", "Alice")]), reveal("q2", [voter("bob", "Bob")])];
    const out = computeRoundSummary(reveals);
    const ids = out.perPlayer.map((p) => p.userId);
    assert.ok(!ids.includes("dave"));
  });

  it("counts incorrect voters toward answered", () => {
    const reveals = [reveal("q1", [], [voter("incorrect-bob", "Bob")])];
    const out = computeRoundSummary(reveals);
    const byId = new Map(out.perPlayer.map((p) => [p.userId, p]));
    assert.equal(byId.get("incorrect-bob")?.answered, 1);
    for (const p of out.perPlayer) {
      assert.equal(p.correct, 0);
    }
  });

  it("does NOT count noAnswer reactors toward answered", () => {
    // noAnswer = reacted but didn't click; not a meaningful "answered" count.
    const reveals = [reveal("q1", [voter("alice")], [], [voter("dave")])];
    const out = computeRoundSummary(reveals);
    const ids = out.perPlayer.map((p) => p.userId);
    assert.ok(ids.includes("alice"));
    assert.ok(!ids.includes("dave"));
  });

  it("ignores reveals with revealResponses === 'no' (no named buckets)", () => {
    const reveals: ProcessRevealEntry[] = [
      {
        questionId: "q1",
        statement: "S",
        category: "X",
        emojis: ["❓"],
        messageLink: "https://example.com",
        wasReprocessed: false,
        answer: { type: "boolean", isTrue: true },
        voters: { revealResponses: "no", reactions: [] },
      },
    ];
    const out = computeRoundSummary(reveals);
    assert.equal(out.totalQuestions, 1);
    assert.deepEqual(out.perPlayer, []);
  });

  it("sorts by correct desc, then displayName asc (case-insensitive)", () => {
    const reveals = [
      reveal("q1", [voter("alice", "alice"), voter("bob", "Bob"), voter("carol", "Carol")]),
    ];
    const out = computeRoundSummary(reveals);
    assert.deepEqual(
      out.perPlayer.map((p) => p.displayName),
      ["alice", "Bob", "Carol"],
    );
  });

  it("does not double-count a player who appears in multiple buckets of the same reveal", () => {
    // Edge case: assume an upstream bucketing step doesn't perfectly dedupe.
    // The same player should only count once per reveal for `answered`.
    const reveals = [
      reveal(
        "q1",
        [voter("alice", "Alice")],
        [voter("alice", "Alice")], // also in incorrect (defensive)
      ),
    ];
    const out = computeRoundSummary(reveals);
    const alice = out.perPlayer.find((p) => p.userId === "alice");
    assert.equal(alice?.answered, 1, "answered counted once per reveal");
  });
});
