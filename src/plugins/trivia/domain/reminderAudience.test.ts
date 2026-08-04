import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { pendingQuestionIds, answeredUserIds, unplayedCandidates } from "./reminderAudience.js";
import type { TriviaQuestion, SubmittedAnswer } from "../core/types.js";

describe("reminderAudience", () => {
  describe("pendingQuestionIds", () => {
    it("returns IDs of questions with postedAt but no processedAt", () => {
      const questions: TriviaQuestion[] = [
        {
          id: "pending1",
          category: "C",
          statement: "Q1",
          emojis: ["🎯"],
          createdAt: 100,
          postedAt: 200,
        },
        {
          id: "pending2",
          category: "C",
          statement: "Q2",
          emojis: ["🎯"],
          createdAt: 100,
          postedAt: 200,
        },
        {
          id: "revealed",
          category: "C",
          statement: "Q3",
          emojis: ["🎯"],
          createdAt: 100,
          postedAt: 200,
          processedAt: 300,
        },
        {
          id: "staged",
          category: "C",
          statement: "Q4",
          emojis: ["🎯"],
          createdAt: 100,
        },
      ];

      const result = pendingQuestionIds(questions);

      assert.deepEqual(result, ["pending1", "pending2"]);
    });

    it("returns empty array when no pending questions", () => {
      const questions: TriviaQuestion[] = [
        {
          id: "revealed",
          category: "C",
          statement: "Q1",
          emojis: ["🎯"],
          createdAt: 100,
          postedAt: 200,
          processedAt: 300,
        },
      ];

      const result = pendingQuestionIds(questions);

      assert.deepEqual(result, []);
    });
  });

  describe("answeredUserIds", () => {
    it("returns user IDs who answered pending questions", () => {
      const answers: SubmittedAnswer[] = [
        { userId: "u1", questionId: "q1", answer: true, timestamp: 100 },
        { userId: "u2", questionId: "q1", answer: false, timestamp: 100 },
        { userId: "u3", questionId: "q2", answerIndex: 0, timestamp: 100 },
        { userId: "u1", questionId: "q3", answer: true, timestamp: 100 }, // not pending
      ];
      const pendingIds = ["q1", "q2"];

      const result = answeredUserIds(answers, pendingIds);

      assert.deepEqual([...result].sort(), ["u1", "u2", "u3"]);
    });

    it("excludes team rows (userIds starting with team:)", () => {
      const answers: SubmittedAnswer[] = [
        { userId: "u1", questionId: "q1", answer: true, timestamp: 100 },
        { userId: "team:alpha", questionId: "q1", answer: false, timestamp: 100 },
        { userId: "u2", questionId: "q2", answerIndex: 0, timestamp: 100 },
      ];
      const pendingIds = ["q1", "q2"];

      const result = answeredUserIds(answers, pendingIds);

      assert.deepEqual([...result].sort(), ["u1", "u2"]);
    });

    it("returns empty set when no pending questions answered", () => {
      const answers: SubmittedAnswer[] = [
        { userId: "u1", questionId: "q3", answer: true, timestamp: 100 },
      ];
      const pendingIds = ["q1", "q2"];

      const result = answeredUserIds(answers, pendingIds);

      assert.equal(result.size, 0);
    });
  });

  describe("unplayedCandidates", () => {
    it("filters candidates to those not in answered set", () => {
      const candidates = ["u1", "u2", "u3", "u4"];
      const answered = new Set(["u2", "u4"]);

      const result = unplayedCandidates(candidates, answered);

      assert.deepEqual(result, ["u1", "u3"]);
    });

    it("preserves order of input candidates", () => {
      const candidates = ["u4", "u1", "u3", "u2"];
      const answered = new Set(["u1", "u2"]);

      const result = unplayedCandidates(candidates, answered);

      assert.deepEqual(result, ["u4", "u3"]);
    });

    it("returns all candidates when none have answered", () => {
      const candidates = ["u1", "u2", "u3"];
      const answered = new Set<string>();

      const result = unplayedCandidates(candidates, answered);

      assert.deepEqual(result, ["u1", "u2", "u3"]);
    });

    it("returns empty array when all have answered", () => {
      const candidates = ["u1", "u2"];
      const answered = new Set(["u1", "u2"]);

      const result = unplayedCandidates(candidates, answered);

      assert.deepEqual(result, []);
    });
  });
});
