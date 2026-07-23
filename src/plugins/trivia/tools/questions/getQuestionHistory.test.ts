import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import {
  createTriviaDataLayer,
  FIXTURE_GAME_NAME,
  fixtureGetGames,
  type FakeTriviaDataLayer,
} from "../../testHelpers.js";
import { createFakeSdk, primeTriviaConfig } from "../../testHelpers.fakeSdk.js";
import { createGetQuestionHistoryTool } from "./getQuestionHistory.js";
import { parseToolResult } from "../../../../plugins-sdk/testHelpers.js";

const SESSION = { sessionId: "test" };

describe("get_question_history", () => {
  let data: FakeTriviaDataLayer;
  let testHelpers: ReturnType<typeof createFakeSdk>["testHelpers"];

  beforeEach(async () => {
    const fakeResult = createFakeSdk();
    const { sdk } = fakeResult;
    testHelpers = fakeResult.testHelpers;
    primeTriviaConfig(sdk);
    const { dataLayer } = createTriviaDataLayer(sdk);
    data = dataLayer;

    await data.forGame(FIXTURE_GAME_NAME).saveQuestion({
      id: "q42",
      category: "Science",
      statement: "Octopuses have three hearts",
      isTrue: true,
      emojis: ["🐙"],
      createdAt: 100,
    });
    await data.forGame(FIXTURE_GAME_NAME).saveQuestion({
      id: "q43",
      category: "History",
      statement: "Rome was founded in 753 BC",
      isTrue: true,
      emojis: ["🏛️"],
      createdAt: 200,
    });
  });

  it("returns type: 'boolean' on the canonical answer key for boolean questions", async () => {
    const tool = createGetQuestionHistoryTool(data, fixtureGetGames);
    const result = await tool.handler({ game: FIXTURE_GAME_NAME, questionId: "q42" }, SESSION);
    const parsed = parseToolResult(result);
    assert.equal(parsed.answersFormat, "boolean");
    assert.equal(parsed.isTrue, true);
  });

  it("returns isTrue, grouped cheaters, and grouped responses for the requested question", async () => {
    await data.forGame(FIXTURE_GAME_NAME).saveCheat({
      cheaterUserId: "U777",
      questionId: "q42",
      reason: "matched prior question",
      detectedAt: "2026-04-16T10:00:00.000Z",
    });
    await data.forGame(FIXTURE_GAME_NAME).saveCheat({
      cheaterUserId: "U888",
      questionId: "q42",
      reason: "admitted in DM",
      detectedAt: "2026-04-16T10:05:00.000Z",
    });
    await data.forGame(FIXTURE_GAME_NAME).saveCheat({
      cheaterUserId: "U999",
      questionId: "q43",
      reason: "different question",
      detectedAt: "2026-04-16T10:10:00.000Z",
    });

    testHelpers.saveUser({ userId: "U1", displayName: "Alice" });
    testHelpers.saveUser({ userId: "U2", displayName: "Bob" });
    testHelpers.saveUser({ userId: "U777", displayName: "Cheater Cathy" });

    await data.forGame(FIXTURE_GAME_NAME).saveAnswer({
      userId: "U1",
      questionId: "q42",
      answer: true,
      correct: true,
      timestamp: 1000,
    });
    await data.forGame(FIXTURE_GAME_NAME).saveAnswer({
      userId: "U2",
      questionId: "q42",
      answer: false,
      correct: false,
      timestamp: 1100,
    });
    await data.forGame(FIXTURE_GAME_NAME).saveAnswer({
      userId: "U777",
      questionId: "q42",
      answer: true,
      correct: true,
      timestamp: 1200,
    });
    await data.forGame(FIXTURE_GAME_NAME).saveAnswer({
      userId: "U1",
      questionId: "q43",
      answer: true,
      correct: true,
      timestamp: 1300,
    });

    const tool = createGetQuestionHistoryTool(data, fixtureGetGames);
    const result = await tool.handler({ game: FIXTURE_GAME_NAME, questionId: "q42" }, SESSION);
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
    await data.forGame(FIXTURE_GAME_NAME).saveCheat({
      cheaterUserId: "U777",
      questionId: "q42",
      reason: "first offense",
      detectedAt: "2026-04-16T10:00:00.000Z",
    });
    await data.forGame(FIXTURE_GAME_NAME).saveCheat({
      cheaterUserId: "U777",
      questionId: "q42",
      reason: "second offense",
      detectedAt: "2026-04-16T10:05:00.000Z",
    });

    const tool = createGetQuestionHistoryTool(data, fixtureGetGames);
    const result = await tool.handler({ game: FIXTURE_GAME_NAME, questionId: "q42" }, SESSION);
    const parsed = parseToolResult(result);

    assert.deepEqual(parsed.cheaterUserIds, ["U777"]);
  });

  it("isolates data between questions", async () => {
    await data.forGame(FIXTURE_GAME_NAME).saveCheat({
      cheaterUserId: "U777",
      questionId: "q42",
      reason: "x",
      detectedAt: "t1",
    });
    await data.forGame(FIXTURE_GAME_NAME).saveCheat({
      cheaterUserId: "U888",
      questionId: "q43",
      reason: "y",
      detectedAt: "t2",
    });
    await data.forGame(FIXTURE_GAME_NAME).saveAnswer({
      userId: "U1",
      questionId: "q42",
      answer: true,
      correct: true,
      timestamp: 1,
    });
    await data.forGame(FIXTURE_GAME_NAME).saveAnswer({
      userId: "U2",
      questionId: "q43",
      answer: false,
      correct: false,
      timestamp: 2,
    });

    const tool = createGetQuestionHistoryTool(data, fixtureGetGames);
    const result42 = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, questionId: "q42" }, SESSION),
    );
    const result43 = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, questionId: "q43" }, SESSION),
    );

    assert.deepEqual(result42.cheaterUserIds, ["U777"]);
    assert.equal(result42.responses.length, 1);
    assert.equal(result42.responses[0].userId, "U1");

    assert.deepEqual(result43.cheaterUserIds, ["U888"]);
    assert.equal(result43.responses.length, 1);
    assert.equal(result43.responses[0].userId, "U2");
  });

  it("returns empty cheaters when no cheats were recorded for the question", async () => {
    await data.forGame(FIXTURE_GAME_NAME).saveAnswer({
      userId: "U1",
      questionId: "q42",
      answer: true,
      correct: true,
      timestamp: 1,
    });

    const tool = createGetQuestionHistoryTool(data, fixtureGetGames);
    const result = await tool.handler({ game: FIXTURE_GAME_NAME, questionId: "q42" }, SESSION);
    const parsed = parseToolResult(result);

    assert.deepEqual(parsed.cheaterUserIds, []);
    assert.equal(parsed.responses.length, 1);
  });

  it("returns empty responses for a freshly posted question with no answers yet", async () => {
    await data.forGame(FIXTURE_GAME_NAME).saveCheat({
      cheaterUserId: "U777",
      questionId: "q42",
      reason: "x",
      detectedAt: "t1",
    });

    const tool = createGetQuestionHistoryTool(data, fixtureGetGames);
    const result = await tool.handler({ game: FIXTURE_GAME_NAME, questionId: "q42" }, SESSION);
    const parsed = parseToolResult(result);

    assert.deepEqual(parsed.responses, []);
    assert.deepEqual(parsed.cheaterUserIds, ["U777"]);
  });

  it("falls back displayName to userId when no user record exists", async () => {
    await data.forGame(FIXTURE_GAME_NAME).saveAnswer({
      userId: "U999",
      questionId: "q42",
      answer: true,
      correct: true,
      timestamp: 1,
    });

    const tool = createGetQuestionHistoryTool(data, fixtureGetGames);
    const result = await tool.handler({ game: FIXTURE_GAME_NAME, questionId: "q42" }, SESSION);
    const parsed = parseToolResult(result);

    assert.equal(parsed.responses.length, 1);
    assert.equal(parsed.responses[0].userId, "U999");
    assert.equal(parsed.responses[0].displayName, "U999");
  });

  it("returns an error when questionId is unknown", async () => {
    const tool = createGetQuestionHistoryTool(data, fixtureGetGames);
    const result = await tool.handler(
      { game: FIXTURE_GAME_NAME, questionId: "does-not-exist" },
      SESSION,
    );
    const parsed = parseToolResult(result);

    assert.ok(parsed.error);
    assert.match(parsed.error, /not found/);
    assert.equal(Object.prototype.hasOwnProperty.call(parsed, "isTrue"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(parsed, "cheaterUserIds"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(parsed, "responses"), false);
  });
});

describe("get_question_history — choice questions", () => {
  let data: FakeTriviaDataLayer;
  let testHelpers: ReturnType<typeof createFakeSdk>["testHelpers"];

  beforeEach(async () => {
    const fakeResult = createFakeSdk();
    const { sdk } = fakeResult;
    testHelpers = fakeResult.testHelpers;
    primeTriviaConfig(sdk);
    const { dataLayer } = createTriviaDataLayer(sdk);
    data = dataLayer;

    await data.forGame(FIXTURE_GAME_NAME).saveQuestion({
      id: "qchoice",
      answersFormat: "choice",
      category: "Geography",
      statement: "Which is the smallest planet?",
      choices: ["Mercury", "Venus", "Earth", "Mars"],
      correctIndex: 0,
      emojis: ["🪐"],
      createdAt: 100,
    });
  });

  it("returns answersFormat, choices, and correctIndex for the canonical answer key", async () => {
    const tool = createGetQuestionHistoryTool(data, fixtureGetGames);
    const result = await tool.handler({ game: FIXTURE_GAME_NAME, questionId: "qchoice" }, SESSION);
    const parsed = parseToolResult(result);
    assert.equal(parsed.answersFormat, "choice");
    assert.deepEqual(parsed.choices, ["Mercury", "Venus", "Earth", "Mars"]);
    assert.equal(parsed.correctIndex, 0);
    assert.equal(Object.prototype.hasOwnProperty.call(parsed, "isTrue"), false);
  });

  it("response entries carry answerIndex (not answer) for choice answers", async () => {
    testHelpers.saveUser({ userId: "U1", displayName: "Alice" });
    await data.forGame(FIXTURE_GAME_NAME).saveAnswer({
      userId: "U1",
      questionId: "qchoice",
      answerIndex: 0,
      correct: true,
      timestamp: 1000,
    });
    await data.forGame(FIXTURE_GAME_NAME).saveAnswer({
      userId: "U2",
      questionId: "qchoice",
      answerIndex: 3,
      correct: false,
      timestamp: 1100,
    });

    const tool = createGetQuestionHistoryTool(data, fixtureGetGames);
    const result = await tool.handler({ game: FIXTURE_GAME_NAME, questionId: "qchoice" }, SESSION);
    const parsed = parseToolResult(result);

    assert.equal(parsed.responses.length, 2);
    for (const r of parsed.responses) {
      assert.equal(typeof r.answerIndex, "number");
      assert.equal(Object.prototype.hasOwnProperty.call(r, "answer"), false);
    }
  });

  // Regression: prior implementation branched isChoice ? ... : booleanShape,
  // which silently returned the boolean shape (with `isTrue: false`) for
  // freeform questions. The handler now owns the response projection.
  it("returns freeform shape for freeform questions (regression: was falling through to boolean)", async () => {
    await data.forGame(FIXTURE_GAME_NAME).saveQuestion({
      id: "qfree",
      category: "Geography",
      statement: "What is the capital of France?",
      answersFormat: "freeform",
      questionType: "fact",
      expectedAnswer: "Paris",
      acceptableAnswers: ["Paris, France"],
      gradingNotes: "Accept any reasonable form.",
      emojis: ["🇫🇷"],
      createdAt: 400,
    });
    await data.forGame(FIXTURE_GAME_NAME).saveAnswer({
      userId: "U-correct",
      questionId: "qfree",
      answerText: "Paris",
      correct: true,
      timestamp: 410,
    });
    await data.forGame(FIXTURE_GAME_NAME).saveAnswer({
      userId: "U-incorrect",
      questionId: "qfree",
      answerText: "London or Paris",
      correct: false,
      judgeReason: "multiple-guess",
      timestamp: 420,
    });
    await data.forGame(FIXTURE_GAME_NAME).saveAnswer({
      userId: "U-pending",
      questionId: "qfree",
      answerText: "tbd",
      timestamp: 430,
    });

    const tool = createGetQuestionHistoryTool(data, fixtureGetGames);
    const result = await tool.handler({ game: FIXTURE_GAME_NAME, questionId: "qfree" }, SESSION);
    const parsed = parseToolResult(result);

    assert.equal(parsed.answersFormat, "freeform");
    assert.equal(parsed.expectedAnswer, "Paris");
    assert.deepEqual(parsed.acceptableAnswers, ["Paris, France"]);
    assert.equal(parsed.gradingNotes, "Accept any reasonable form.");
    assert.equal(Object.prototype.hasOwnProperty.call(parsed, "isTrue"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(parsed, "correctIndex"), false);
    assert.equal(parsed.responses.length, 3);

    interface FreeformRow {
      userId: string;
      answerText: string;
      correct?: boolean;
      judgeReason?: string;
    }
    const responses: FreeformRow[] = parsed.responses;
    const byUser = new Map(responses.map((r) => [r.userId, r]));
    const correctRow = byUser.get("U-correct");
    assert.ok(correctRow);
    assert.equal(correctRow.answerText, "Paris");
    assert.equal(correctRow.correct, true);
    assert.equal(Object.prototype.hasOwnProperty.call(correctRow, "judgeReason"), false);

    const incorrectRow = byUser.get("U-incorrect");
    assert.ok(incorrectRow);
    assert.equal(incorrectRow.correct, false);
    assert.equal(incorrectRow.judgeReason, "multiple-guess");

    const pendingRow = byUser.get("U-pending");
    assert.ok(pendingRow);
    assert.equal(pendingRow.answerText, "tbd");
    assert.equal(Object.prototype.hasOwnProperty.call(pendingRow, "correct"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(pendingRow, "judgeReason"), false);
  });
});

describe("get_question_history — shared-buzzer team slots", () => {
  let data: FakeTriviaDataLayer;

  beforeEach(async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    ({ dataLayer: data } = createTriviaDataLayer(sdk));
    await data.forGame(FIXTURE_GAME_NAME).saveQuestion({
      id: "q42",
      category: "Science",
      statement: "Octopuses have three hearts",
      isTrue: true,
      emojis: ["🐙"],
      createdAt: 100,
    });
  });

  it("surfaces team-answer slots (with ownerKey + lastAnsweredBy) for byTeam questions", async () => {
    await data.forGame(FIXTURE_GAME_NAME).upsertTeamAnswer({
      teamName: "Red",
      questionId: "q42",
      answer: true,
      correct: true,
      lastAnsweredBy: "U1",
      timestamp: 500,
    });
    const tool = createGetQuestionHistoryTool(data, fixtureGetGames);

    const parsed = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, questionId: "q42" }, SESSION),
    );
    assert.equal(parsed.teamAnswers.length, 1);
    assert.deepEqual(parsed.teamAnswers[0], {
      ownerKey: "team:Red",
      teamName: "Red",
      lastAnsweredBy: "U1",
      answer: true,
      correct: true,
    });
  });

  it("omits teamAnswers when the question has no team slots", async () => {
    const tool = createGetQuestionHistoryTool(data, fixtureGetGames);
    const parsed = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, questionId: "q42" }, SESSION),
    );
    assert.equal(Object.prototype.hasOwnProperty.call(parsed, "teamAnswers"), false);
  });
});
