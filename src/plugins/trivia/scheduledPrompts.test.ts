import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createSendQuestionsInstructionsTool } from "./sendQuestionsInstructions.js";
import { createProcessResponsesInstructionsTool } from "./processResponsesInstructions.js";
import { createCreateSchedulesInstructionsTool } from "./createSchedulesInstructions.js";
import { parseToolResult } from "../../tools/testHelpers.js";

const SESSION = { sessionId: "test" };

describe("send_questions_instructions tool", () => {
  it("returns a non-empty prompt", async () => {
    const tool = createSendQuestionsInstructionsTool();
    const result = await tool.handler({}, SESSION);
    const body = parseToolResult(result);
    assert.equal(typeof body.prompt, "string");
    assert.ok(body.prompt.length > 100);
  });

  it("references the required trivia tools by bare name", async () => {
    const tool = createSendQuestionsInstructionsTool();
    const result = await tool.handler({}, SESSION);
    const body = parseToolResult(result);
    assert.match(body.prompt, /get_ideas/);
    assert.match(body.prompt, /find_previous_questions/);
    assert.match(body.prompt, /save_question/);
    assert.match(body.prompt, /submit_response/);
  });

  it("enforces the difficulty gate and reaction ordering", async () => {
    const tool = createSendQuestionsInstructionsTool();
    const result = await tool.handler({}, SESSION);
    const body = parseToolResult(result);
    assert.match(body.prompt, /3\/10/);
    assert.match(body.prompt, /4\/10/);
    assert.match(body.prompt, /"\+1", "-1"/);
    assert.match(body.prompt, /5-7\/10/);
  });

  it("invites invented styles rather than prescribing a rotation", async () => {
    const tool = createSendQuestionsInstructionsTool();
    const result = await tool.handler({}, SESSION);
    const body = parseToolResult(result);
    assert.match(body.prompt, /invent a style/i);
    assert.match(body.prompt, /Example/);
    assert.doesNotMatch(body.prompt, /rotate between them/);
  });
});

describe("process_responses_instructions tool", () => {
  it("returns a non-empty prompt", async () => {
    const tool = createProcessResponsesInstructionsTool();
    const result = await tool.handler({}, SESSION);
    const body = parseToolResult(result);
    assert.equal(typeof body.prompt, "string");
    assert.ok(body.prompt.length > 100);
  });

  it("references the required tools by name", async () => {
    const tool = createProcessResponsesInstructionsTool();
    const result = await tool.handler({}, SESSION);
    const body = parseToolResult(result);
    assert.match(body.prompt, /fetch_channel_messages/);
    assert.match(body.prompt, /find_previous_questions/);
    assert.match(body.prompt, /get_question_history/);
    assert.match(body.prompt, /submit_answers/);
    assert.match(body.prompt, /submit_response/);
  });

  it("does NOT reference cheat DETECTION — that is handled by trivia-check only", async () => {
    const tool = createProcessResponsesInstructionsTool();
    const result = await tool.handler({}, SESSION);
    const body = parseToolResult(result);
    assert.doesNotMatch(body.prompt, /save_cheating/);
    assert.doesNotMatch(body.prompt, /<@ASKER_ID>/);
  });

  it("instructs silent cheater exclusion using cheaterUserIds from get_question_history", async () => {
    const tool = createProcessResponsesInstructionsTool();
    const result = await tool.handler({}, SESSION);
    const body = parseToolResult(result);
    assert.match(body.prompt, /cheaterUserIds/);
    assert.match(body.prompt, /silent/i);
    assert.match(body.prompt, /never name a caught cheater/i);
    assert.match(body.prompt, /MUST NOT appear anywhere in the reveal/);
  });

  it("instructs cheater exclusion from the submit_answers payload as well", async () => {
    const tool = createProcessResponsesInstructionsTool();
    const result = await tool.handler({}, SESSION);
    const body = parseToolResult(result);
    assert.match(body.prompt, /cheaters are already absent/i);
  });

  it("describes the questionId resolution fallback", async () => {
    const tool = createProcessResponsesInstructionsTool();
    const result = await tool.handler({}, SESSION);
    const body = parseToolResult(result);
    assert.match(body.prompt, /refine the keyword/i);
    assert.match(body.prompt, /most[- ]?recent/i);
    assert.match(body.prompt, /empty array/i);
  });

  it("enforces bot exclusion without hardcoding a specific bot user ID", async () => {
    const tool = createProcessResponsesInstructionsTool();
    const result = await tool.handler({}, SESSION);
    const body = parseToolResult(result);
    assert.match(body.prompt, /bot's own user ID/i);
    assert.doesNotMatch(body.prompt, /U0A8WSEBF7B/);
  });

  it("requires submit_answers before submit_response", async () => {
    const tool = createProcessResponsesInstructionsTool();
    const result = await tool.handler({}, SESSION);
    const body = parseToolResult(result);
    assert.match(body.prompt, /BEFORE submit_response/);
  });

  it("names the four voter situations Clack should cover", async () => {
    const tool = createProcessResponsesInstructionsTool();
    const result = await tool.handler({}, SESSION);
    const body = parseToolResult(result);
    assert.match(body.prompt, /CORRECT voters/);
    assert.match(body.prompt, /INCORRECT voters/);
    assert.match(body.prompt, /FENCE-SITTERS/);
    assert.match(body.prompt, /WILDCARDS/);
  });

  it("instructs to skip any voter situation with no qualifying users", async () => {
    const tool = createProcessResponsesInstructionsTool();
    const result = await tool.handler({}, SESSION);
    const body = parseToolResult(result);
    assert.match(body.prompt, /Skip anything with no qualifying users entirely/i);
    assert.match(body.prompt, /cover whichever ones actually apply/i);
  });

  it("does not prescribe a rigid four-sub-group layout", async () => {
    const tool = createProcessResponsesInstructionsTool();
    const result = await tool.handler({}, SESSION);
    const body = parseToolResult(result);
    assert.match(
      body.prompt,
      /NOT required to use four sections, four headings, or any fixed structure/i,
    );
  });
});

describe("create_schedules_instructions tool", () => {
  it("returns a non-empty recipe", async () => {
    const tool = createCreateSchedulesInstructionsTool();
    const result = await tool.handler({}, SESSION);
    const body = parseToolResult(result);
    assert.equal(typeof body.prompt, "string");
    assert.ok(body.prompt.length > 100);
  });

  it("describes both Schedule A and Schedule B", async () => {
    const tool = createCreateSchedulesInstructionsTool();
    const result = await tool.handler({}, SESSION);
    const body = parseToolResult(result);
    assert.match(body.prompt, /Schedule A/);
    assert.match(body.prompt, /Schedule B/);
  });

  it("specifies plugin: trivia and the per-schedule requiredTools", async () => {
    const tool = createCreateSchedulesInstructionsTool();
    const result = await tool.handler({}, SESSION);
    const body = parseToolResult(result);
    assert.match(body.prompt, /plugin: "trivia"/);
    assert.match(body.prompt, /mcp__trivia__send_questions_instructions/);
    assert.match(body.prompt, /mcp__trivia__get_ideas/);
    assert.match(body.prompt, /mcp__trivia__find_previous_questions/);
    assert.match(body.prompt, /mcp__trivia__save_question/);
    assert.match(body.prompt, /mcp__trivia__process_responses_instructions/);
    assert.match(body.prompt, /mcp__clack__fetch_channel_messages/);
    assert.match(body.prompt, /mcp__trivia__get_question_history/);
    assert.match(body.prompt, /mcp__trivia__submit_answers/);
  });

  it("Schedule B requiredTools includes find_previous_questions and get_question_history", async () => {
    const tool = createCreateSchedulesInstructionsTool();
    const result = await tool.handler({}, SESSION);
    const body = parseToolResult(result);
    const scheduleB = body.prompt.split(/## Schedule B/)[1] ?? "";
    assert.match(scheduleB, /mcp__trivia__find_previous_questions/);
    assert.match(scheduleB, /mcp__trivia__get_question_history/);
    assert.match(scheduleB, /mcp__trivia__process_responses_instructions/);
    assert.match(scheduleB, /mcp__clack__fetch_channel_messages/);
    assert.match(scheduleB, /mcp__trivia__submit_answers/);
  });

  it("Schedule A requiredTools is unchanged by this revision", async () => {
    const tool = createCreateSchedulesInstructionsTool();
    const result = await tool.handler({}, SESSION);
    const body = parseToolResult(result);
    const scheduleA = body.prompt.split(/## Schedule A/)[1]?.split(/## Schedule B/)[0] ?? "";
    assert.match(scheduleA, /mcp__trivia__send_questions_instructions/);
    assert.match(scheduleA, /mcp__trivia__get_ideas/);
    assert.match(scheduleA, /mcp__trivia__find_previous_questions/);
    assert.match(scheduleA, /mcp__trivia__save_question/);
    assert.doesNotMatch(scheduleA, /mcp__trivia__get_question_history/);
  });

  it("instructs Clack to ask for times and does not hardcode a cron default", async () => {
    const tool = createCreateSchedulesInstructionsTool();
    const result = await tool.handler({}, SESSION);
    const body = parseToolResult(result);
    assert.match(body.prompt, /ASK FOR BOTH TIMES/);
    assert.doesNotMatch(body.prompt, /0 11 \* \* 1-5/);
    assert.doesNotMatch(body.prompt, /0 13 \* \* 1-5/);
  });

  it("does NOT mention cheat detection, save_cheating, or ASKER_ID", async () => {
    const tool = createCreateSchedulesInstructionsTool();
    const result = await tool.handler({}, SESSION);
    const body = parseToolResult(result);
    assert.doesNotMatch(body.prompt, /save_cheating/);
    assert.doesNotMatch(body.prompt, /<@ASKER_ID>/);
    assert.doesNotMatch(body.prompt, /ASKER_ID/);
    assert.doesNotMatch(body.prompt, /cheat/i);
  });

  it("instructs Clack to detect duplicates before creating", async () => {
    const tool = createCreateSchedulesInstructionsTool();
    const result = await tool.handler({}, SESSION);
    const body = parseToolResult(result);
    assert.match(body.prompt, /DETECT DUPLICATES/i);
    assert.match(body.prompt, /list_scheduled_messages/);
  });
});
