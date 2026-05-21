import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { InputBlock } from "@slack/types";
import {
  buildFreeformModal,
  readAnswerTextFromSubmission,
  readModalMetadata,
  FREEFORM_MODAL_INTERNALS,
} from "./modal.js";
import type { TriviaQuestion } from "../core/types.js";

function findInputBlock(blocks: ReadonlyArray<{ type: string }>): InputBlock {
  for (const b of blocks) {
    if (b.type === "input") return b as InputBlock;
  }
  throw new Error("no input block found");
}

function makeQuestion(overrides: Partial<TriviaQuestion> = {}): TriviaQuestion {
  return {
    id: "q-1",
    category: "Geography",
    statement: "What is the capital of France?",
    answersFormat: "freeform",
    questionType: "fact",
    expectedAnswer: "Paris",
    emojis: ["🌍"],
    createdAt: 0,
    ...overrides,
  };
}

describe("buildFreeformModal", () => {
  it("renders an active modal with an empty input when no pending answer", () => {
    const view = buildFreeformModal({
      callbackId: "plugin:trivia:freeform-modal:q-1",
      question: makeQuestion(),
      locked: false,
      game: "main",
    });
    assert.equal(view.callback_id, "plugin:trivia:freeform-modal:q-1");
    assert.equal(view.submit?.text, "Submit answer");
    const inputBlock = findInputBlock(view.blocks);
    if (inputBlock.element.type === "plain_text_input") {
      assert.equal(inputBlock.element.initial_value, undefined);
    } else {
      assert.fail("expected a plain_text_input element");
    }
  });

  it("pre-fills the input when a pending answer is supplied", () => {
    const view = buildFreeformModal({
      callbackId: "plugin:trivia:freeform-modal:q-1",
      question: makeQuestion(),
      locked: false,
      pendingAnswer: "Paris",
      game: "main",
    });
    const inputBlock = findInputBlock(view.blocks);
    if (inputBlock.element.type === "plain_text_input") {
      assert.equal(inputBlock.element.initial_value, "Paris");
    } else {
      assert.fail("expected a plain_text_input element");
    }
  });

  it("locked view has no submit button and shows the prior submission with verdict", () => {
    const view = buildFreeformModal({
      callbackId: "plugin:trivia:freeform-modal:q-1",
      question: makeQuestion(),
      locked: true,
      lockedRow: { answerText: "Paris", correct: true },
      game: "main",
    });
    assert.equal(view.submit, undefined);
    const bodyText = JSON.stringify(view.blocks);
    assert.ok(bodyText.includes("Paris"));
    assert.ok(/correct/i.test(bodyText));
  });

  it("locked view without a submission shows the no-answer state", () => {
    const view = buildFreeformModal({
      callbackId: "plugin:trivia:freeform-modal:q-1",
      question: makeQuestion(),
      locked: true,
      game: "main",
    });
    const bodyText = JSON.stringify(view.blocks);
    assert.ok(/did not submit/i.test(bodyText));
  });

  it("private_metadata carries the game and question id", () => {
    const view = buildFreeformModal({
      callbackId: "plugin:trivia:freeform-modal:q-1",
      question: makeQuestion({ id: "q-xyz" }),
      locked: false,
      game: "main",
    });
    const meta = readModalMetadata(view.private_metadata ?? "");
    assert.deepEqual(meta, { game: "main", questionId: "q-xyz" });
  });
});

describe("readAnswerTextFromSubmission", () => {
  it("returns the trimmed text from the modal's input block", () => {
    const view = {
      state: {
        values: {
          [FREEFORM_MODAL_INTERNALS.INPUT_BLOCK_ID]: {
            [FREEFORM_MODAL_INTERNALS.ACTION_ID]: { value: "  Paris  " },
          },
        },
      },
    };
    assert.equal(readAnswerTextFromSubmission(view), "Paris");
  });

  it("returns an empty string when the input is null/missing", () => {
    assert.equal(readAnswerTextFromSubmission({ state: { values: {} } }), "");
  });
});

describe("readModalMetadata", () => {
  it("returns null on malformed JSON", () => {
    assert.equal(readModalMetadata("not json"), null);
  });

  it("returns null when game/questionId are missing", () => {
    assert.equal(readModalMetadata(JSON.stringify({ game: "main" })), null);
  });
});
