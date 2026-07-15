import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { computeRoundSummary, type RoundAnswer } from "./roundSummary.js";

function ans(questionId: string, userId: string, correct: boolean): RoundAnswer {
  return { questionId, userId, correct };
}

// Default display-name resolver: capitalize the userId so case-insensitive sort
// assertions read naturally. Individual tests override with an explicit map.
const cap = (id: string) => id.charAt(0).toUpperCase() + id.slice(1);

/** No question is worth more than 1 — `points` tracks `correct` throughout. */
const ALL_ONE_POINT = new Map<string, number>();

describe("computeRoundSummary", () => {
  it("returns empty result for zero questions", () => {
    const out = computeRoundSummary([], [], cap, ALL_ONE_POINT);
    assert.equal(out.totalQuestions, 0);
    assert.deepEqual(out.perPlayer, []);
  });

  it("totalQuestions reflects revealed count even when a question went unanswered", () => {
    const out = computeRoundSummary(["q1", "q2"], [ans("q1", "alice", true)], cap, ALL_ONE_POINT);
    assert.equal(out.totalQuestions, 2);
    assert.equal(out.perPlayer.length, 1);
  });

  it("length-1 single-correct result", () => {
    const out = computeRoundSummary(["q1"], [ans("q1", "alice", true)], cap, ALL_ONE_POINT);
    assert.equal(out.totalQuestions, 1);
    assert.equal(out.perPlayer.length, 1);
    assert.equal(out.perPlayer[0].userId, "alice");
    assert.equal(out.perPlayer[0].correct, 1);
    assert.equal(out.perPlayer[0].answered, 1);
    assert.equal(out.perPlayer[0].roundMvp, true);
  });

  it("length-3 aggregation across players", () => {
    // alice: correct q1+q2, incorrect q3 → 2/3
    // bob: correct q1, didn't answer q2, correct q3 → 2/2
    // carol: correct on all three → 3/3
    const answers = [
      ans("q1", "alice", true),
      ans("q1", "bob", true),
      ans("q1", "carol", true),
      ans("q2", "alice", true),
      ans("q2", "carol", true),
      ans("q3", "alice", false),
      ans("q3", "bob", true),
      ans("q3", "carol", true),
    ];
    const out = computeRoundSummary(["q1", "q2", "q3"], answers, cap, ALL_ONE_POINT);
    assert.equal(out.totalQuestions, 3);

    const byId = new Map(out.perPlayer.map((p) => [p.userId, p]));
    assert.equal(byId.get("alice")?.correct, 2);
    assert.equal(byId.get("alice")?.answered, 3);
    assert.equal(byId.get("alice")?.roundMvp, undefined);
    assert.equal(byId.get("alice")?.perfectRound, undefined);

    // bob answered only 2 of the 3 questions — a partial sweep is not perfect.
    assert.equal(byId.get("bob")?.correct, 2);
    assert.equal(byId.get("bob")?.answered, 2);
    assert.equal(byId.get("bob")?.roundMvp, undefined);
    assert.equal(byId.get("bob")?.perfectRound, undefined);

    assert.equal(byId.get("carol")?.correct, 3);
    assert.equal(byId.get("carol")?.answered, 3);
    assert.equal(byId.get("carol")?.roundMvp, true);
    assert.equal(byId.get("carol")?.perfectRound, true);
  });

  it("multiple MVPs when tied at the top", () => {
    const answers = [
      ans("q1", "alice", true),
      ans("q1", "bob", true),
      ans("q2", "alice", true),
      ans("q2", "bob", true),
    ];
    const out = computeRoundSummary(["q1", "q2"], answers, cap, ALL_ONE_POINT);
    assert.equal(out.perPlayer.filter((p) => p.roundMvp).length, 2);
  });

  it("no MVPs when nobody scored correct", () => {
    const answers = [ans("q1", "alice", false), ans("q2", "alice", false), ans("q2", "bob", false)];
    const out = computeRoundSummary(["q1", "q2"], answers, cap, ALL_ONE_POINT);
    assert.equal(out.perPlayer.length, 2);
    assert.equal(
      out.perPlayer.filter((p) => p.roundMvp).length,
      0,
      "no roundMvp on zero-correct entries",
    );
  });

  it("counts incorrect answers toward answered", () => {
    const out = computeRoundSummary(["q1"], [ans("q1", "bob", false)], cap, ALL_ONE_POINT);
    const bob = out.perPlayer.find((p) => p.userId === "bob");
    assert.equal(bob?.answered, 1);
    assert.equal(bob?.correct, 0);
  });

  it("ignores answers for questions NOT in the revealed set", () => {
    // q2 is not a revealed question this fire — its answers must not count.
    const out = computeRoundSummary(
      ["q1"],
      [ans("q1", "alice", true), ans("q2", "alice", true), ans("q2", "bob", true)],
      cap,
      ALL_ONE_POINT,
    );
    assert.equal(out.totalQuestions, 1);
    assert.equal(out.perPlayer.length, 1);
    assert.equal(out.perPlayer[0].userId, "alice");
    assert.equal(out.perPlayer[0].correct, 1);
  });

  it("is mode-independent — there is no revealResponses input at all", () => {
    // The scoreboard derives purely from scored answers; the same answers always
    // yield the same scoreboard regardless of how the reveal was displayed.
    const answers = [ans("q1", "alice", true), ans("q1", "bob", false)];
    const out = computeRoundSummary(["q1"], answers, cap, ALL_ONE_POINT);
    assert.equal(out.totalQuestions, 1);
    const byId = new Map(out.perPlayer.map((p) => [p.userId, p]));
    assert.equal(byId.get("alice")?.correct, 1);
    assert.equal(byId.get("bob")?.correct, 0);
    assert.equal(byId.get("bob")?.answered, 1);
  });

  it("sorts by correct desc, then displayName asc (case-insensitive)", () => {
    const names: Record<string, string> = { alice: "alice", bob: "Bob", carol: "Carol" };
    const answers = [ans("q1", "alice", true), ans("q1", "bob", true), ans("q1", "carol", true)];
    const out = computeRoundSummary(["q1"], answers, (id) => names[id] ?? id, ALL_ONE_POINT);
    assert.deepEqual(
      out.perPlayer.map((p) => p.displayName),
      ["alice", "Bob", "Carol"],
    );
  });

  it("dedupes duplicate rows for the same (question, user) — correct if any row is correct", () => {
    const answers = [ans("q1", "alice", false), ans("q1", "alice", true)];
    const out = computeRoundSummary(["q1"], answers, cap, ALL_ONE_POINT);
    const alice = out.perPlayer.find((p) => p.userId === "alice");
    assert.equal(alice?.answered, 1, "answered counted once per question");
    assert.equal(alice?.correct, 1, "correct when any row for that question is correct");
  });

  it("resolves displayName via the supplied resolver, falling back to userId", () => {
    const out = computeRoundSummary(
      ["q1"],
      [ans("q1", "U123", true)],
      (id) => (id === "U123" ? "Zoe" : id),
      ALL_ONE_POINT,
    );
    assert.equal(out.perPlayer[0].displayName, "Zoe");
  });

  describe("perfectRound", () => {
    it("flags a clean sweep of a 3-question fire", () => {
      const answers = [
        ans("q1", "carol", true),
        ans("q2", "carol", true),
        ans("q3", "carol", true),
        ans("q1", "alice", true),
        ans("q2", "alice", true),
        ans("q3", "alice", false),
      ];
      const out = computeRoundSummary(["q1", "q2", "q3"], answers, cap, ALL_ONE_POINT);
      const byId = new Map(out.perPlayer.map((p) => [p.userId, p]));
      assert.equal(byId.get("carol")?.perfectRound, true);
      assert.equal(byId.get("alice")?.perfectRound, undefined, "2/3 is not perfect");
    });

    it("does NOT flag a partial player who got everything they answered right", () => {
      // bob answered only q1+q2 (both correct) and skipped q3 → correct 2 < totalQuestions 3.
      const answers = [ans("q1", "bob", true), ans("q2", "bob", true)];
      const out = computeRoundSummary(["q1", "q2", "q3"], answers, cap, ALL_ONE_POINT);
      assert.equal(out.perPlayer[0].perfectRound, undefined);
    });

    it("does NOT flag a sweep below the 3-question threshold", () => {
      const answers = [ans("q1", "alice", true), ans("q2", "alice", true)];
      const out = computeRoundSummary(["q1", "q2"], answers, cap, ALL_ONE_POINT);
      const alice = out.perPlayer[0];
      assert.equal(alice.correct, 2);
      assert.equal(alice.roundMvp, true, "still the MVP");
      assert.equal(alice.perfectRound, undefined, "2-question sweep is not a perfect round");
    });

    it("does NOT flag a 1-question sweep", () => {
      const out = computeRoundSummary(["q1"], [ans("q1", "alice", true)], cap, ALL_ONE_POINT);
      assert.equal(out.perPlayer[0].perfectRound, undefined);
    });

    it("flags every player who sweeps a 4-question fire", () => {
      const answers = ["q1", "q2", "q3", "q4"].flatMap((q) => [
        ans(q, "alice", true),
        ans(q, "bob", true),
      ]);
      const out = computeRoundSummary(["q1", "q2", "q3", "q4"], answers, cap, ALL_ONE_POINT);
      assert.equal(out.perPlayer.filter((p) => p.perfectRound).length, 2);
      assert.ok(
        out.perPlayer.every((p) => p.roundMvp),
        "both are also MVPs",
      );
    });
  });

  describe("points", () => {
    it("tracks correct exactly on a uniform fire", () => {
      const answers = [
        ans("q1", "alice", true),
        ans("q2", "alice", true),
        ans("q3", "alice", false),
      ];
      const out = computeRoundSummary(["q1", "q2", "q3"], answers, cap, ALL_ONE_POINT);
      assert.equal(out.perPlayer[0].correct, 2);
      assert.equal(out.perPlayer[0].points, 2);
    });

    it("pays each correct question its stamped worth", () => {
      const weighted = new Map([["q1", 3]]);
      const answers = [ans("q1", "alice", true), ans("q2", "bob", true)];
      const out = computeRoundSummary(["q1", "q2"], answers, cap, weighted);

      const alice = out.perPlayer.find((p) => p.userId === "alice");
      const bob = out.perPlayer.find((p) => p.userId === "bob");
      assert.deepEqual(
        { correct: alice?.correct, points: alice?.points, mvp: alice?.roundMvp },
        { correct: 1, points: 3, mvp: true },
      );
      assert.deepEqual(
        { correct: bob?.correct, points: bob?.points, mvp: bob?.roundMvp },
        { correct: 1, points: 1, mvp: undefined },
      );
    });

    it("pays nothing for a wrong answer on a high-value question", () => {
      const weighted = new Map([["q1", 5]]);
      const out = computeRoundSummary(["q1"], [ans("q1", "alice", false)], cap, weighted);
      assert.equal(out.perPlayer[0].points, 0);
      assert.equal(out.perPlayer[0].roundMvp, undefined, "no MVP when nobody scored");
    });

    it("sorts by points, so fewer correct can outrank more", () => {
      const weighted = new Map([["q1", 5]]);
      const answers = [ans("q1", "alice", true), ans("q2", "bob", true), ans("q3", "bob", true)];
      const out = computeRoundSummary(["q1", "q2", "q3"], answers, cap, weighted);
      assert.deepEqual(
        out.perPlayer.map((p) => p.userId),
        ["alice", "bob"],
      );
    });

    it("splits perfectRound from roundMvp on a weighted fire", () => {
      // q1 is worth 3. Alice sweeps all three (5 pts); Bob answers all three but
      // only lands q1 (3 pts). Perfection is about completeness, MVP about points.
      const weighted = new Map([["q1", 3]]);
      const answers = [
        ans("q1", "alice", true),
        ans("q2", "alice", true),
        ans("q3", "alice", true),
        ans("q1", "bob", true),
        ans("q2", "bob", false),
        ans("q3", "bob", false),
      ];
      const out = computeRoundSummary(["q1", "q2", "q3"], answers, cap, weighted);

      const alice = out.perPlayer.find((p) => p.userId === "alice");
      const bob = out.perPlayer.find((p) => p.userId === "bob");
      assert.equal(alice?.points, 5);
      assert.equal(alice?.perfectRound, true);
      assert.equal(alice?.roundMvp, true);
      assert.equal(bob?.points, 3);
      assert.equal(bob?.perfectRound, undefined);
      assert.equal(bob?.roundMvp, undefined);
    });

    it("a non-perfect player can take MVP by out-pointing a perfect one", () => {
      // q1 is worth 10: Bob's single hit out-points Alice's clean sweep.
      const weighted = new Map([["q1", 10]]);
      const answers = [
        ans("q1", "alice", false),
        ans("q2", "alice", true),
        ans("q3", "alice", true),
        ans("q1", "bob", true),
      ];
      const out = computeRoundSummary(["q1", "q2", "q3"], answers, cap, weighted);

      const alice = out.perPlayer.find((p) => p.userId === "alice");
      const bob = out.perPlayer.find((p) => p.userId === "bob");
      assert.equal(alice?.roundMvp, undefined);
      assert.equal(alice?.perfectRound, undefined, "she missed q1, so not a sweep");
      assert.equal(bob?.roundMvp, true);
      assert.equal(bob?.points, 10);
    });
  });
});
