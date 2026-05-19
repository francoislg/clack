import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SEND_QUESTIONS_INSTRUCTIONS,
  getProcessResponsesInstructions,
} from "./scheduledPrompts.js";

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

  it("sizes reactions array to suggestedChoiceCount with :one: first", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /reactions: \["one", "two"\]/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /reactions: \["one", "two", "three"\]/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /reactions: \["one", "two", "three", "four"\]/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /one.{0,4}must be the first reaction/);
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

describe("getProcessResponsesInstructions — choice path", () => {
  it("resolves question type BEFORE parsing reactions (re-ordering)", () => {
    const prompt = getProcessResponsesInstructions(false);
    assert.match(prompt, /capture its `id` AND its `type`/);
    assert.match(prompt, /BEFORE any reaction parsing/);
  });

  it("describes the type-discriminated get_question_history return shape", () => {
    const prompt = getProcessResponsesInstructions(false);
    assert.match(prompt, /type: "boolean", isTrue/);
    assert.match(prompt, /type: "choice", choices, correctIndex/);
  });

  it("encodes numbered-emoji → index mapping (one→0, two→1, three→2, four→3)", () => {
    const prompt = getProcessResponsesInstructions(false);
    assert.match(prompt, /:one: → index 0/);
    assert.match(prompt, /:two: → index 1/);
    assert.match(prompt, /:three: → index 2/);
    assert.match(prompt, /:four: → index 3/);
  });

  it("silently voids multi-react voters on the choice path", () => {
    const prompt = getProcessResponsesInstructions(false);
    assert.match(prompt, /MULTI-REACT voters/);
    assert.match(prompt, /SILENTLY VOIDED/i);
    assert.match(prompt, /NEVER mentioned in the user-facing reveal/);
    assert.match(prompt, /DO NOT surface multi-react voters/i);
  });

  it("submit_answers payload shape branches by question.type", () => {
    const prompt = getProcessResponsesInstructions(false);
    assert.match(prompt, /\{ userId: "U123", displayName: "John Doe", answer: true \}/);
    assert.match(prompt, /\{ userId: "U123", displayName: "John Doe", answerIndex: 2 \}/);
  });

  it("hard-fails choice reveals when the question cannot be resolved", () => {
    const prompt = getProcessResponsesInstructions(false);
    assert.match(prompt, /POST AN ADMIN-FACING ERROR/i);
    assert.match(prompt, /Aborting the reveal/i);
    assert.match(prompt, /CANNOT proceed because `correctIndex` is unknown/i);
    assert.match(prompt, /Do NOT guess `correctIndex`/);
  });

  it("preserves boolean best-effort fallback for unresolved boolean questions", () => {
    const prompt = getProcessResponsesInstructions(false);
    assert.match(prompt, /BOOLEAN reveals.*best-effort/s);
  });

  it("names three choice-path voter situations (no FENCE-SITTERS for choice)", () => {
    const prompt = getProcessResponsesInstructions(false);
    assert.match(prompt, /CHOICE PATH voter situations \(THREE/);
  });
});
