import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createInMemoryDataLayer } from "./testHelpers.js";
import { createGetQuestionHistoryTool } from "./getQuestionHistory.js";
import { parseToolResult } from "../../tools/testHelpers.js";
import type { TriviaDataLayer } from "./types.js";

const SESSION = { sessionId: "test" };

describe("get_question_history", () => {
  let data: TriviaDataLayer;

  beforeEach(async () => {
    data = createInMemoryDataLayer();
    await data.saveQuestion({
      id: "q42",
      category: "Science",
      statement: "Octopuses have three hearts",
      isTrue: true,
      emojis: ["🐙"],
      createdAt: 100,
    });
    await data.saveQuestion({
      id: "q43",
      category: "History",
      statement: "Rome was founded in 753 BC",
      isTrue: true,
      emojis: ["🏛️"],
      createdAt: 200,
    });
  });

  it("returns isTrue, grouped cheaters, and grouped responses for the requested question", async () => {
    await data.saveCheat({
      cheaterUserId: "U777",
      questionId: "q42",
      reason: "matched prior question",
      detectedAt: "2026-04-16T10:00:00.000Z",
    });
    await data.saveCheat({
      cheaterUserId: "U888",
      questionId: "q42",
      reason: "admitted in DM",
      detectedAt: "2026-04-16T10:05:00.000Z",
    });
    await data.saveCheat({
      cheaterUserId: "U999",
      questionId: "q43",
      reason: "different question",
      detectedAt: "2026-04-16T10:10:00.000Z",
    });

    await data.saveUser({ userId: "U1", displayName: "Alice", joinedAt: 1 });
    await data.saveUser({ userId: "U2", displayName: "Bob", joinedAt: 2 });
    await data.saveUser({ userId: "U777", displayName: "Cheater Cathy", joinedAt: 3 });

    await data.saveAnswer({
      userId: "U1",
      questionId: "q42",
      answer: true,
      correct: true,
      timestamp: 1000,
    });
    await data.saveAnswer({
      userId: "U2",
      questionId: "q42",
      answer: false,
      correct: false,
      timestamp: 1100,
    });
    await data.saveAnswer({
      userId: "U777",
      questionId: "q42",
      answer: true,
      correct: true,
      timestamp: 1200,
    });
    await data.saveAnswer({
      userId: "U1",
      questionId: "q43",
      answer: true,
      correct: true,
      timestamp: 1300,
    });

    const tool = createGetQuestionHistoryTool(data);
    const result = await tool.handler({ questionId: "q42" }, SESSION);
    const parsed = parseToolResult(result);

    assert.equal(parsed.isTrue, true);
    assert.deepEqual(parsed.cheaterUserIds.sort(), ["U777", "U888"]);
    assert.equal(parsed.responses.length, 3);

    const byUser = new Map<string, { displayName: string; answer: boolean; correct: boolean }>(
      parsed.responses.map(
        (r: { userId: string; displayName: string; answer: boolean; correct: boolean }) => [
          r.userId,
          { displayName: r.displayName, answer: r.answer, correct: r.correct },
        ],
      ),
    );
    assert.deepEqual(byUser.get("U1"), { displayName: "Alice", answer: true, correct: true });
    assert.deepEqual(byUser.get("U2"), { displayName: "Bob", answer: false, correct: false });
    assert.deepEqual(byUser.get("U777"), {
      displayName: "Cheater Cathy",
      answer: true,
      correct: true,
    });
  });

  it("deduplicates cheaters who were caught more than once on the same question", async () => {
    await data.saveCheat({
      cheaterUserId: "U777",
      questionId: "q42",
      reason: "first offense",
      detectedAt: "2026-04-16T10:00:00.000Z",
    });
    await data.saveCheat({
      cheaterUserId: "U777",
      questionId: "q42",
      reason: "second offense",
      detectedAt: "2026-04-16T10:05:00.000Z",
    });

    const tool = createGetQuestionHistoryTool(data);
    const result = await tool.handler({ questionId: "q42" }, SESSION);
    const parsed = parseToolResult(result);

    assert.deepEqual(parsed.cheaterUserIds, ["U777"]);
  });

  it("isolates data between questions", async () => {
    await data.saveCheat({
      cheaterUserId: "U777",
      questionId: "q42",
      reason: "x",
      detectedAt: "t1",
    });
    await data.saveCheat({
      cheaterUserId: "U888",
      questionId: "q43",
      reason: "y",
      detectedAt: "t2",
    });
    await data.saveAnswer({
      userId: "U1",
      questionId: "q42",
      answer: true,
      correct: true,
      timestamp: 1,
    });
    await data.saveAnswer({
      userId: "U2",
      questionId: "q43",
      answer: false,
      correct: false,
      timestamp: 2,
    });

    const tool = createGetQuestionHistoryTool(data);
    const result42 = parseToolResult(await tool.handler({ questionId: "q42" }, SESSION));
    const result43 = parseToolResult(await tool.handler({ questionId: "q43" }, SESSION));

    assert.deepEqual(result42.cheaterUserIds, ["U777"]);
    assert.equal(result42.responses.length, 1);
    assert.equal(result42.responses[0].userId, "U1");

    assert.deepEqual(result43.cheaterUserIds, ["U888"]);
    assert.equal(result43.responses.length, 1);
    assert.equal(result43.responses[0].userId, "U2");
  });

  it("returns empty cheaters when no cheats were recorded for the question", async () => {
    await data.saveAnswer({
      userId: "U1",
      questionId: "q42",
      answer: true,
      correct: true,
      timestamp: 1,
    });

    const tool = createGetQuestionHistoryTool(data);
    const result = await tool.handler({ questionId: "q42" }, SESSION);
    const parsed = parseToolResult(result);

    assert.deepEqual(parsed.cheaterUserIds, []);
    assert.equal(parsed.responses.length, 1);
  });

  it("returns empty responses for a freshly posted question with no answers yet", async () => {
    await data.saveCheat({
      cheaterUserId: "U777",
      questionId: "q42",
      reason: "x",
      detectedAt: "t1",
    });

    const tool = createGetQuestionHistoryTool(data);
    const result = await tool.handler({ questionId: "q42" }, SESSION);
    const parsed = parseToolResult(result);

    assert.deepEqual(parsed.responses, []);
    assert.deepEqual(parsed.cheaterUserIds, ["U777"]);
  });

  it("falls back displayName to userId when no user record exists", async () => {
    await data.saveAnswer({
      userId: "U999",
      questionId: "q42",
      answer: true,
      correct: true,
      timestamp: 1,
    });

    const tool = createGetQuestionHistoryTool(data);
    const result = await tool.handler({ questionId: "q42" }, SESSION);
    const parsed = parseToolResult(result);

    assert.equal(parsed.responses.length, 1);
    assert.equal(parsed.responses[0].userId, "U999");
    assert.equal(parsed.responses[0].displayName, "U999");
  });

  it("returns an error when questionId is unknown", async () => {
    const tool = createGetQuestionHistoryTool(data);
    const result = await tool.handler({ questionId: "does-not-exist" }, SESSION);
    const parsed = parseToolResult(result);

    assert.ok(parsed.error);
    assert.match(parsed.error, /not found/);
    assert.equal(Object.prototype.hasOwnProperty.call(parsed, "isTrue"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(parsed, "cheaterUserIds"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(parsed, "responses"), false);
  });
});
