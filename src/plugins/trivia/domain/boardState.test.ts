import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { hasUnrevealedPostedQuestions } from "./boardState.js";
import type { TriviaQuestion } from "../core/types.js";

function makeQuestion(overrides: Partial<TriviaQuestion>): TriviaQuestion {
  return {
    id: "q",
    category: "C",
    statement: "stmt",
    answersFormat: "boolean",
    questionType: "fact",
    isTrue: true,
    emojis: ["🎯"],
    createdAt: 0,
    ...overrides,
  };
}

describe("hasUnrevealedPostedQuestions", () => {
  it("is false for an empty board", () => {
    assert.equal(hasUnrevealedPostedQuestions([]), false);
  });

  it("is false when every posted question is processed", () => {
    const questions = [
      makeQuestion({ id: "q1", postedAt: 1_000, processedAt: 2_000 }),
      makeQuestion({ id: "q2", postedAt: 3_000, processedAt: 4_000 }),
    ];
    assert.equal(hasUnrevealedPostedQuestions(questions), false);
  });

  it("ignores staged (never-posted) questions", () => {
    const questions = [makeQuestion({ id: "q1" })];
    assert.equal(hasUnrevealedPostedQuestions(questions), false);
  });

  it("is true when a posted question lacks processedAt", () => {
    const questions = [
      makeQuestion({ id: "q1", postedAt: 1_000, processedAt: 2_000 }),
      makeQuestion({ id: "q2", postedAt: 3_000 }),
    ];
    assert.equal(hasUnrevealedPostedQuestions(questions), true);
  });
});
