import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { computeRoundSummary, type RoundAnswer } from "./roundSummary.js";

function ans(questionId: string, userId: string, correct: boolean): RoundAnswer {
  return { questionId, userId, correct };
}

// Default display-name resolver: capitalize the userId so case-insensitive sort
// assertions read naturally. Individual tests override with an explicit map.
const cap = (id: string) => id.charAt(0).toUpperCase() + id.slice(1);

describe("computeRoundSummary", () => {
  it("returns empty result for zero questions", () => {
    const out = computeRoundSummary([], [], cap);
    assert.equal(out.totalQuestions, 0);
    assert.deepEqual(out.perPlayer, []);
  });

  it("totalQuestions reflects revealed count even when a question went unanswered", () => {
    const out = computeRoundSummary(["q1", "q2"], [ans("q1", "alice", true)], cap);
    assert.equal(out.totalQuestions, 2);
    assert.equal(out.perPlayer.length, 1);
  });

  it("length-1 single-correct result", () => {
    const out = computeRoundSummary(["q1"], [ans("q1", "alice", true)], cap);
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
    const out = computeRoundSummary(["q1", "q2", "q3"], answers, cap);
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
    const answers = [
      ans("q1", "alice", true),
      ans("q1", "bob", true),
      ans("q2", "alice", true),
      ans("q2", "bob", true),
    ];
    const out = computeRoundSummary(["q1", "q2"], answers, cap);
    assert.equal(out.perPlayer.filter((p) => p.roundMvp).length, 2);
  });

  it("no MVPs when nobody scored correct", () => {
    const answers = [ans("q1", "alice", false), ans("q2", "alice", false), ans("q2", "bob", false)];
    const out = computeRoundSummary(["q1", "q2"], answers, cap);
    assert.equal(out.perPlayer.length, 2);
    assert.equal(
      out.perPlayer.filter((p) => p.roundMvp).length,
      0,
      "no roundMvp on zero-correct entries",
    );
  });

  it("counts incorrect answers toward answered", () => {
    const out = computeRoundSummary(["q1"], [ans("q1", "bob", false)], cap);
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
    const out = computeRoundSummary(["q1"], answers, cap);
    assert.equal(out.totalQuestions, 1);
    const byId = new Map(out.perPlayer.map((p) => [p.userId, p]));
    assert.equal(byId.get("alice")?.correct, 1);
    assert.equal(byId.get("bob")?.correct, 0);
    assert.equal(byId.get("bob")?.answered, 1);
  });

  it("sorts by correct desc, then displayName asc (case-insensitive)", () => {
    const names: Record<string, string> = { alice: "alice", bob: "Bob", carol: "Carol" };
    const answers = [ans("q1", "alice", true), ans("q1", "bob", true), ans("q1", "carol", true)];
    const out = computeRoundSummary(["q1"], answers, (id) => names[id] ?? id);
    assert.deepEqual(
      out.perPlayer.map((p) => p.displayName),
      ["alice", "Bob", "Carol"],
    );
  });

  it("dedupes duplicate rows for the same (question, user) — correct if any row is correct", () => {
    const answers = [ans("q1", "alice", false), ans("q1", "alice", true)];
    const out = computeRoundSummary(["q1"], answers, cap);
    const alice = out.perPlayer.find((p) => p.userId === "alice");
    assert.equal(alice?.answered, 1, "answered counted once per question");
    assert.equal(alice?.correct, 1, "correct when any row for that question is correct");
  });

  it("resolves displayName via the supplied resolver, falling back to userId", () => {
    const out = computeRoundSummary(["q1"], [ans("q1", "U123", true)], (id) =>
      id === "U123" ? "Zoe" : id,
    );
    assert.equal(out.perPlayer[0].displayName, "Zoe");
  });
});
