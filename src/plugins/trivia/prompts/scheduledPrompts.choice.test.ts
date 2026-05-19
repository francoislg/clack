import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SEND_QUESTIONS_INSTRUCTIONS } from "./scheduledPrompts.js";

describe("SEND_QUESTIONS_INSTRUCTIONS — choice path", () => {
  it("branches on suggestedType", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /suggestedType/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /BOOLEAN PATH/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /CHOICE PATH/);
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

  it("describes both stacked and inline Block Kit layouts", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /Stacked/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /Inline/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /25 characters/);
  });

  it("explains the tool-attached reactions without instructing Claude to pass them", () => {
    // Reactions are derived inside post_questions from the question's stored type. The prompt
    // mentions the resulting reaction sets EXPLANATORILY so Claude knows what to expect — and
    // explicitly tells Claude NOT to pass a reactions argument.
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /"one", "two", "three", "four"/);
    assert.doesNotMatch(SEND_QUESTIONS_INSTRUCTIONS, /reactions:\s*\["one"/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /do NOT pass a `reactions` argument/i);
  });

  it("aligns numbered-emoji card order with stored choices array order", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /MUST match the stored `choices` array order/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /1️⃣ for index 0, 2️⃣ for index 1/);
  });

  it('save_question call uses type: "choice" + choices + correctIndex', () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /type: "choice"/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /choices \(array of suggestedChoiceCount strings/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /correctIndex \(MUST equal suggestedCorrectIndex\)/);
  });

  it("preserves the boolean path unchanged (existing tests must still pass)", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /Branch on suggestedAnswer/i);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /POLARITY SELF-CHECK/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /"\+1", "-1"/);
  });
});
