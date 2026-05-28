import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { SEND_QUESTIONS_INSTRUCTIONS } from "./scheduledPrompts.js";

describe("SEND_QUESTIONS_INSTRUCTIONS — choice path", () => {
  it("branches on suggestedAnswersFormat × suggestedQuestionType (4 paths)", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /suggestedAnswersFormat/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /suggestedQuestionType/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /FACT-BOOLEAN PATH/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /FACT-CHOICE PATH/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /TOPICAL-BOOLEAN PATH/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /TOPICAL-CHOICE PATH/);
  });

  it("instructs Claude to write the correct answer FIRST at suggestedCorrectIndex", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /WRITE THE CORRECT ANSWER FIRST/i);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /suggestedCorrectIndex/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /MUST NOT rewrite or swap the correct answer/i);
  });

  it("encodes the four-condition distractor plausibility gate", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /DISTRACTOR PLAUSIBILITY GATE/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /correct answer plausibility ≥ 5/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /highest distractor plausibility ≥ 4/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /correct − highest_distractor ≤ 4/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /every distractor plausibility ≥ 2/);
  });

  it("enforces rewrite-only-distractors and 3-pass retry budget", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /REWRITE ONLY THE FAILING DISTRACTOR/i);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /never the correct answer/i);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /3 distractor-rewrite passes/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /ABANDON this question/i);
  });

  it("describes the per-format actions block appended by post_questions", () => {
    // Choices render as buttons (1️⃣, 2️⃣, …) sized to choices.length — the tool appends them,
    // Claude does not render an inline option list in the blocks anymore.
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /actions.*block/i);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /1️⃣/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /choices\.length/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /stored `choices` array order/);
  });

  it("documents the 40-char hard cap on choice labels", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /40 characters/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /save_question` rejects/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /button label/);
  });

  it('save_question call uses answersFormat: "choice" + choices + correctIndex', () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /answersFormat: "choice"/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /choices \(array of suggestedChoiceCount strings/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /correctIndex \(MUST equal suggestedCorrectIndex\)/);
  });

  it("preserves the boolean path unchanged (existing tests must still pass)", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /Branch on suggestedAnswer/i);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /POLARITY SELF-CHECK/);
    // Boolean affordance is now a button pair, not a reactions list.
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /👍 TRUE/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /👎 FALSE/);
  });
});
