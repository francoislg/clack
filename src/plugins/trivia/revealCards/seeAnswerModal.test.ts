import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { buildSeeAnswerModal } from "./seeAnswerModal.js";
import type { TriviaQuestion } from "../core/types.js";

function booleanQ(overrides: Partial<TriviaQuestion> = {}): TriviaQuestion {
  return {
    id: "Q1",
    category: "C",
    statement: "S",
    answersFormat: "boolean",
    questionType: "fact",
    isTrue: true,
    emojis: ["🎯"],
    createdAt: 0,
    ...overrides,
  };
}

/** Pull the verdict line — the last section block in the modal. */
function verdictText(view: ReturnType<typeof buildSeeAnswerModal>): string {
  const block = view.blocks[view.blocks.length - 1];
  if (!("text" in block)) throw new Error("expected a section block with text");
  const txt = block.text;
  if (typeof txt !== "object" || txt === null || !("text" in txt)) {
    throw new Error("expected a section block with a text object");
  }
  return txt.text;
}

describe("buildSeeAnswerModal", () => {
  it("is read-only — Close button, no submit", () => {
    const view = buildSeeAnswerModal({ question: booleanQ() });
    assert.equal(view.submit, undefined);
    assert.ok(view.close !== undefined);
    assert.equal(view.title.text, "Trivia — your answer");
  });

  it("shows a correct verdict with the user's pick", () => {
    const view = buildSeeAnswerModal({
      question: booleanQ(),
      myRow: { userId: "U1", questionId: "Q1", answer: true, correct: true, timestamp: 1 },
    });
    assert.match(verdictText(view), /Your answer: \*👍 TRUE\* — correct!/);
  });

  it("shows an incorrect verdict", () => {
    const view = buildSeeAnswerModal({
      question: booleanQ(),
      myRow: { userId: "U1", questionId: "Q1", answer: false, correct: false, timestamp: 1 },
    });
    assert.match(verdictText(view), /Your answer: \*👎 FALSE\* — incorrect/);
  });

  it('shows "did not answer" when no row exists', () => {
    const view = buildSeeAnswerModal({ question: booleanQ() });
    assert.match(verdictText(view), /did not submit an answer/);
  });

  it("renders the chosen option for choice questions", () => {
    const q = booleanQ({
      answersFormat: "choice",
      isTrue: undefined,
      choices: ["The Beatles", "Cream"],
      correctIndex: 1,
    });
    const view = buildSeeAnswerModal({
      question: q,
      myRow: { userId: "U1", questionId: "Q1", answerIndex: 0, correct: false, timestamp: 1 },
    });
    assert.match(verdictText(view), /Your answer: \*The Beatles\* — incorrect/);
  });

  it("renders the typed text for freeform questions", () => {
    const q = booleanQ({ answersFormat: "freeform", isTrue: undefined, expectedAnswer: "Paris" });
    const view = buildSeeAnswerModal({
      question: q,
      myRow: { userId: "U1", questionId: "Q1", answerText: "Lyon", correct: false, timestamp: 1 },
    });
    assert.match(verdictText(view), /Your answer: \*Lyon\* — incorrect/);
  });
});
