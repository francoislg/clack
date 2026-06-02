import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { isExactMatch, normalizeAnswer } from "./normalize.js";
import type { TriviaQuestion } from "../core/types.js";

function makeQuestion(overrides: Partial<TriviaQuestion>): TriviaQuestion {
  return {
    id: "q-1",
    category: "Geography",
    statement: "What is the capital of France?",
    answersFormat: "freeform",
    questionType: "fact",
    expectedAnswer: "Paris",
    freeformAnswerShape: "place",
    emojis: ["🌍"],
    createdAt: 0,
    ...overrides,
  };
}

describe("normalizeAnswer", () => {
  it("lowercases", () => {
    assert.equal(normalizeAnswer("PARIS"), "paris");
  });

  it("trims leading and trailing whitespace", () => {
    assert.equal(normalizeAnswer("  paris  "), "paris");
  });

  it("collapses internal whitespace runs to a single space", () => {
    assert.equal(normalizeAnswer("the   roman\tempire"), "the roman empire");
  });

  it("does NOT remove punctuation", () => {
    assert.equal(normalizeAnswer("C++"), "c++");
    assert.equal(normalizeAnswer("$5"), "$5");
    assert.equal(normalizeAnswer("Paris."), "paris.");
  });

  it("does NOT fold accents", () => {
    assert.equal(normalizeAnswer("Café"), "café");
  });
});

describe("isExactMatch", () => {
  it("matches the exact canonical answer", () => {
    assert.equal(isExactMatch(makeQuestion({}), "Paris"), true);
  });

  it("matches case and whitespace variants of the canonical answer", () => {
    const q = makeQuestion({ expectedAnswer: "The Roman Empire" });
    assert.equal(isExactMatch(q, "  the   ROMAN empire "), true);
  });

  it("matches any acceptable variant", () => {
    const q = makeQuestion({
      expectedAnswer: "New York City",
      acceptableAnswers: ["NYC", "New York"],
    });
    assert.equal(isExactMatch(q, "nyc"), true);
    assert.equal(isExactMatch(q, "new york"), true);
  });

  it("does not match a different answer", () => {
    assert.equal(isExactMatch(makeQuestion({}), "London"), false);
  });

  it("does not match a qualifier form (left to the model judge)", () => {
    assert.equal(isExactMatch(makeQuestion({}), "Tokyo, Japan"), false);
  });

  it("never folds materially-different strings together", () => {
    assert.equal(isExactMatch(makeQuestion({ expectedAnswer: "C++" }), "C"), false);
    assert.equal(isExactMatch(makeQuestion({ expectedAnswer: "$5" }), "5"), false);
    assert.equal(isExactMatch(makeQuestion({ expectedAnswer: "café" }), "cafe"), false);
  });

  it("handles absent or empty acceptableAnswers", () => {
    assert.equal(isExactMatch(makeQuestion({ acceptableAnswers: undefined }), "London"), false);
    assert.equal(isExactMatch(makeQuestion({ acceptableAnswers: [] }), "London"), false);
  });

  it("returns false when expectedAnswer is absent and nothing else matches", () => {
    const q = makeQuestion({ expectedAnswer: undefined, acceptableAnswers: ["Paris"] });
    assert.equal(isExactMatch(q, "London"), false);
    assert.equal(isExactMatch(q, "paris"), true);
  });
});
