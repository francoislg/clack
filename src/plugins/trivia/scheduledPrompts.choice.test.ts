import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createSendQuestionsInstructionsTool } from "./sendQuestionsInstructions.js";
import { createProcessResponsesInstructionsTool } from "./processResponsesInstructions.js";
import { parseToolResult } from "../../tools/testHelpers.js";

const SESSION = { sessionId: "test" };

describe("send_questions_instructions — choice path", () => {
  it("branches on suggestedType", async () => {
    const tool = createSendQuestionsInstructionsTool();
    const result = await tool.handler({}, SESSION);
    const body = parseToolResult(result);
    assert.match(body.prompt, /suggestedType/);
    assert.match(body.prompt, /BOOLEAN PATH/);
    assert.match(body.prompt, /CHOICE PATH/);
  });

  it("instructs Claude to write the correct answer FIRST at suggestedCorrectIndex", async () => {
    const tool = createSendQuestionsInstructionsTool();
    const result = await tool.handler({}, SESSION);
    const body = parseToolResult(result);
    assert.match(body.prompt, /WRITE THE CORRECT ANSWER FIRST/i);
    assert.match(body.prompt, /suggestedCorrectIndex/);
    assert.match(body.prompt, /MUST NOT rewrite or swap the correct answer/i);
  });

  it("encodes the four-condition distractor plausibility gate", async () => {
    const tool = createSendQuestionsInstructionsTool();
    const result = await tool.handler({}, SESSION);
    const body = parseToolResult(result);
    assert.match(body.prompt, /DISTRACTOR PLAUSIBILITY GATE/);
    assert.match(body.prompt, /correct answer plausibility ≥ 5/);
    assert.match(body.prompt, /highest distractor plausibility ≥ 4/);
    assert.match(body.prompt, /correct − highest_distractor ≤ 4/);
    assert.match(body.prompt, /every distractor plausibility ≥ 2/);
  });

  it("enforces rewrite-only-distractors and 3-pass retry budget", async () => {
    const tool = createSendQuestionsInstructionsTool();
    const result = await tool.handler({}, SESSION);
    const body = parseToolResult(result);
    assert.match(body.prompt, /REWRITE ONLY THE FAILING DISTRACTOR/i);
    assert.match(body.prompt, /never the correct answer/i);
    assert.match(body.prompt, /3 distractor-rewrite passes/);
    assert.match(body.prompt, /ABANDON this question/i);
  });

  it("describes both stacked and inline Block Kit layouts", async () => {
    const tool = createSendQuestionsInstructionsTool();
    const result = await tool.handler({}, SESSION);
    const body = parseToolResult(result);
    assert.match(body.prompt, /Stacked/);
    assert.match(body.prompt, /Inline/);
    assert.match(body.prompt, /25 characters/);
  });

  it("sizes reactions array to suggestedChoiceCount with :one: first", async () => {
    const tool = createSendQuestionsInstructionsTool();
    const result = await tool.handler({}, SESSION);
    const body = parseToolResult(result);
    assert.match(body.prompt, /reactions: \["one", "two"\]/);
    assert.match(body.prompt, /reactions: \["one", "two", "three"\]/);
    assert.match(body.prompt, /reactions: \["one", "two", "three", "four"\]/);
    assert.match(body.prompt, /one.{0,4}must be the first reaction/);
  });

  it('save_question call uses type: "choice" + choices + correctIndex', async () => {
    const tool = createSendQuestionsInstructionsTool();
    const result = await tool.handler({}, SESSION);
    const body = parseToolResult(result);
    assert.match(body.prompt, /type: "choice"/);
    assert.match(body.prompt, /choices \(array of suggestedChoiceCount strings/);
    assert.match(body.prompt, /correctIndex \(MUST equal suggestedCorrectIndex\)/);
  });

  it("preserves the boolean path unchanged (existing tests must still pass)", async () => {
    const tool = createSendQuestionsInstructionsTool();
    const result = await tool.handler({}, SESSION);
    const body = parseToolResult(result);
    // Spot-check key boolean-path text that pre-existed
    assert.match(body.prompt, /Branch on suggestedAnswer/i);
    assert.match(body.prompt, /POLARITY SELF-CHECK/);
    assert.match(body.prompt, /"\+1", "-1"/);
  });
});

describe("process_responses_instructions — choice path", () => {
  it("resolves question type BEFORE parsing reactions (re-ordering)", async () => {
    const tool = createProcessResponsesInstructionsTool();
    const result = await tool.handler({}, SESSION);
    const body = parseToolResult(result);
    // The resolution step still mentions capturing `id` and `type`
    assert.match(body.prompt, /capture its `id` AND its `type`/);
    assert.match(body.prompt, /BEFORE any reaction parsing/);
  });

  it("describes the type-discriminated get_question_history return shape", async () => {
    const tool = createProcessResponsesInstructionsTool();
    const result = await tool.handler({}, SESSION);
    const body = parseToolResult(result);
    assert.match(body.prompt, /type: "boolean", isTrue/);
    assert.match(body.prompt, /type: "choice", choices, correctIndex/);
  });

  it("encodes numbered-emoji → index mapping (one→0, two→1, three→2, four→3)", async () => {
    const tool = createProcessResponsesInstructionsTool();
    const result = await tool.handler({}, SESSION);
    const body = parseToolResult(result);
    assert.match(body.prompt, /:one: → index 0/);
    assert.match(body.prompt, /:two: → index 1/);
    assert.match(body.prompt, /:three: → index 2/);
    assert.match(body.prompt, /:four: → index 3/);
  });

  it("silently voids multi-react voters on the choice path", async () => {
    const tool = createProcessResponsesInstructionsTool();
    const result = await tool.handler({}, SESSION);
    const body = parseToolResult(result);
    assert.match(body.prompt, /MULTI-REACT voters/);
    assert.match(body.prompt, /SILENTLY VOIDED/i);
    assert.match(body.prompt, /NEVER mentioned in the user-facing reveal/);
    assert.match(body.prompt, /DO NOT surface multi-react voters/i);
  });

  it("submit_answers payload shape branches by question.type", async () => {
    const tool = createProcessResponsesInstructionsTool();
    const result = await tool.handler({}, SESSION);
    const body = parseToolResult(result);
    // Boolean shape
    assert.match(body.prompt, /\{ userId: "U123", displayName: "John Doe", answer: true \}/);
    // Choice shape
    assert.match(body.prompt, /\{ userId: "U123", displayName: "John Doe", answerIndex: 2 \}/);
  });

  it("hard-fails choice reveals when the question cannot be resolved", async () => {
    const tool = createProcessResponsesInstructionsTool();
    const result = await tool.handler({}, SESSION);
    const body = parseToolResult(result);
    assert.match(body.prompt, /POST AN ADMIN-FACING ERROR/i);
    assert.match(body.prompt, /Aborting the reveal/i);
    assert.match(body.prompt, /CANNOT proceed because `correctIndex` is unknown/i);
    assert.match(body.prompt, /Do NOT guess `correctIndex`/);
  });

  it("preserves boolean best-effort fallback for unresolved boolean questions", async () => {
    const tool = createProcessResponsesInstructionsTool();
    const result = await tool.handler({}, SESSION);
    const body = parseToolResult(result);
    assert.match(body.prompt, /BOOLEAN reveals.*best-effort/s);
  });

  it("names three choice-path voter situations (no FENCE-SITTERS for choice)", async () => {
    const tool = createProcessResponsesInstructionsTool();
    const result = await tool.handler({}, SESSION);
    const body = parseToolResult(result);
    assert.match(body.prompt, /CHOICE PATH voter situations \(THREE/);
  });
});
