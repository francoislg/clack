import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createSendQuestionsInstructionsTool } from "./sendQuestionsInstructions.js";
import { createProcessResponsesInstructionsTool } from "./processResponsesInstructions.js";
import { createCreateSchedulesInstructionsTool } from "./createSchedulesInstructions.js";

const SESSION = { sessionId: "test" };

function parseResult(result: { content: { text: string }[] }) {
  return JSON.parse(result.content[0].text);
}

describe("send_questions_instructions tool", () => {
  it("returns a non-empty prompt", async () => {
    const tool = createSendQuestionsInstructionsTool();
    const result = await tool.handler({}, SESSION);
    const body = parseResult(result);
    assert.equal(typeof body.prompt, "string");
    assert.ok(body.prompt.length > 100);
  });

  it("references the required trivia tools by bare name", async () => {
    const tool = createSendQuestionsInstructionsTool();
    const result = await tool.handler({}, SESSION);
    const body = parseResult(result);
    assert.match(body.prompt, /get_ideas/);
    assert.match(body.prompt, /find_previous_questions/);
    assert.match(body.prompt, /save_question/);
    assert.match(body.prompt, /submit_response/);
  });

  it("enforces the difficulty gate and reaction ordering", async () => {
    const tool = createSendQuestionsInstructionsTool();
    const result = await tool.handler({}, SESSION);
    const body = parseResult(result);
    assert.match(body.prompt, /3\/10/);
    assert.match(body.prompt, /4\/10/);
    assert.match(body.prompt, /"\+1", "-1"/);
    assert.match(body.prompt, /5-7\/10/);
  });

  it("invites invented styles rather than prescribing a rotation", async () => {
    const tool = createSendQuestionsInstructionsTool();
    const result = await tool.handler({}, SESSION);
    const body = parseResult(result);
    assert.match(body.prompt, /invent a style/i);
    assert.match(body.prompt, /Example/);
    assert.doesNotMatch(body.prompt, /rotate between them/);
  });
});

describe("process_responses_instructions tool", () => {
  it("returns a non-empty prompt", async () => {
    const tool = createProcessResponsesInstructionsTool();
    const result = await tool.handler({}, SESSION);
    const body = parseResult(result);
    assert.equal(typeof body.prompt, "string");
    assert.ok(body.prompt.length > 100);
  });

  it("references the required tools by name", async () => {
    const tool = createProcessResponsesInstructionsTool();
    const result = await tool.handler({}, SESSION);
    const body = parseResult(result);
    assert.match(body.prompt, /fetch_channel_messages/);
    assert.match(body.prompt, /submit_answers/);
    assert.match(body.prompt, /submit_response/);
  });

  it("does NOT reference cheat detection — that is handled by trivia-check only", async () => {
    const tool = createProcessResponsesInstructionsTool();
    const result = await tool.handler({}, SESSION);
    const body = parseResult(result);
    assert.doesNotMatch(body.prompt, /save_cheating/);
    assert.doesNotMatch(body.prompt, /<@ASKER_ID>/);
    assert.doesNotMatch(body.prompt, /cheat/i);
  });

  it("enforces bot exclusion without hardcoding a specific bot user ID", async () => {
    const tool = createProcessResponsesInstructionsTool();
    const result = await tool.handler({}, SESSION);
    const body = parseResult(result);
    assert.match(body.prompt, /bot's own user ID/i);
    assert.doesNotMatch(body.prompt, /U0A8WSEBF7B/);
  });

  it("requires submit_answers before submit_response", async () => {
    const tool = createProcessResponsesInstructionsTool();
    const result = await tool.handler({}, SESSION);
    const body = parseResult(result);
    assert.match(body.prompt, /BEFORE submit_response/);
  });

  it("includes the four voter-category labels", async () => {
    const tool = createProcessResponsesInstructionsTool();
    const result = await tool.handler({}, SESSION);
    const body = parseResult(result);
    assert.match(body.prompt, /Nailed it! 🎉/);
    assert.match(body.prompt, /Not quite! 💪/);
    assert.match(body.prompt, /Playing both sides, eh\? 🤨/);
    assert.match(body.prompt, /Wait, what\? 🤔/);
  });
});

describe("create_schedules_instructions tool", () => {
  it("returns a non-empty recipe", async () => {
    const tool = createCreateSchedulesInstructionsTool();
    const result = await tool.handler({}, SESSION);
    const body = parseResult(result);
    assert.equal(typeof body.prompt, "string");
    assert.ok(body.prompt.length > 100);
  });

  it("describes both Schedule A and Schedule B", async () => {
    const tool = createCreateSchedulesInstructionsTool();
    const result = await tool.handler({}, SESSION);
    const body = parseResult(result);
    assert.match(body.prompt, /Schedule A/);
    assert.match(body.prompt, /Schedule B/);
  });

  it("specifies plugin: trivia and the per-schedule requiredTools", async () => {
    const tool = createCreateSchedulesInstructionsTool();
    const result = await tool.handler({}, SESSION);
    const body = parseResult(result);
    assert.match(body.prompt, /plugin: "trivia"/);
    assert.match(body.prompt, /mcp__trivia__send_questions_instructions/);
    assert.match(body.prompt, /mcp__trivia__get_ideas/);
    assert.match(body.prompt, /mcp__trivia__find_previous_questions/);
    assert.match(body.prompt, /mcp__trivia__save_question/);
    assert.match(body.prompt, /mcp__trivia__process_responses_instructions/);
    assert.match(body.prompt, /mcp__clack__fetch_channel_messages/);
    assert.match(body.prompt, /mcp__trivia__submit_answers/);
  });

  it("instructs Clack to ask for times and does not hardcode a cron default", async () => {
    const tool = createCreateSchedulesInstructionsTool();
    const result = await tool.handler({}, SESSION);
    const body = parseResult(result);
    assert.match(body.prompt, /ASK FOR BOTH TIMES/);
    assert.doesNotMatch(body.prompt, /0 11 \* \* 1-5/);
    assert.doesNotMatch(body.prompt, /0 13 \* \* 1-5/);
  });

  it("does NOT mention cheat detection, save_cheating, or ASKER_ID", async () => {
    const tool = createCreateSchedulesInstructionsTool();
    const result = await tool.handler({}, SESSION);
    const body = parseResult(result);
    assert.doesNotMatch(body.prompt, /save_cheating/);
    assert.doesNotMatch(body.prompt, /<@ASKER_ID>/);
    assert.doesNotMatch(body.prompt, /ASKER_ID/);
    assert.doesNotMatch(body.prompt, /cheat/i);
  });

  it("instructs Clack to detect duplicates before creating", async () => {
    const tool = createCreateSchedulesInstructionsTool();
    const result = await tool.handler({}, SESSION);
    const body = parseResult(result);
    assert.match(body.prompt, /DETECT DUPLICATES/i);
    assert.match(body.prompt, /list_scheduled_messages/);
  });
});
