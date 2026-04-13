import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createInMemoryDataLayer } from "./data.js";
import { createGetPastTopicsTool } from "./getPastTopics.js";
import { createGenerateQuestionTool } from "./generateQuestion.js";
import { createRegisterUserTool } from "./registerUser.js";
import { createSubmitAnswerTool } from "./submitAnswer.js";
import { createRetrieveScoresTool } from "./retrieveScores.js";
import type { TriviaDataLayer } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseResult(result: { content: { text: string }[] }) {
  return JSON.parse(result.content[0].text);
}

const SESSION = { sessionId: "test" };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("trivia plugin", () => {
  let data: TriviaDataLayer;

  beforeEach(() => {
    data = createInMemoryDataLayer();
  });

  // -------------------------------------------------------------------------
  // get_past_topics
  // -------------------------------------------------------------------------

  describe("get_past_topics", () => {
    it("returns empty topics when no questions exist", async () => {
      const tool = createGetPastTopicsTool(data);
      const result = await tool.handler({ limit: undefined }, SESSION);
      const parsed = parseResult(result);
      assert.deepEqual(parsed.topics, []);
      assert.equal(parsed.questionCount, 0);
    });

    it("returns recent topics after questions are added", async () => {
      await data.saveQuestion({
        id: "q1",
        topic: "Science",
        statement: "Water boils at 100C at sea level",
        isTrue: true,
        emojis: ["🔬"],
        createdAt: 1,
      });
      await data.saveQuestion({
        id: "q2",
        topic: "History",
        statement: "The Roman Empire fell in 476 AD",
        isTrue: true,
        emojis: ["🏛️"],
        createdAt: 2,
      });

      const tool = createGetPastTopicsTool(data);
      const result = await tool.handler({ limit: undefined }, SESSION);
      const parsed = parseResult(result);
      assert.deepEqual(parsed.topics, ["Science", "History"]);
      assert.equal(parsed.questionCount, 2);
    });

    it("respects limit parameter", async () => {
      for (let i = 0; i < 5; i++) {
        await data.saveQuestion({
          id: `q${i}`,
          topic: `Topic${i}`,
          statement: `Statement about topic ${i} that is long enough`,
          isTrue: true,
          emojis: ["🎯"],
          createdAt: i,
        });
      }

      const tool = createGetPastTopicsTool(data);
      const result = await tool.handler({ limit: 2 }, SESSION);
      const parsed = parseResult(result);
      assert.equal(parsed.topics.length, 2);
      assert.deepEqual(parsed.topics, ["Topic3", "Topic4"]);
    });
  });

  // -------------------------------------------------------------------------
  // generate_question
  // -------------------------------------------------------------------------

  describe("generate_question", () => {
    it("saves a valid question", async () => {
      const tool = createGenerateQuestionTool(data);
      const result = await tool.handler(
        {
          topic: "Geography",
          statement: "Mount Everest is the tallest mountain on Earth",
          isTrue: true,
          emojis: ["🏔️", "🌍"],
        },
        SESSION,
      );
      const parsed = parseResult(result);
      assert.equal(parsed.saved, true);
      assert.equal(parsed.question.topic, "Geography");
      assert.ok(parsed.question.id);

      const questions = await data.loadQuestions();
      assert.equal(questions.length, 1);
    });

    it("rejects statement shorter than 10 characters", async () => {
      const tool = createGenerateQuestionTool(data);
      const result = await tool.handler(
        { topic: "Science", statement: "Short", isTrue: true, emojis: ["🔬"] },
        SESSION,
      );
      const parsed = parseResult(result);
      assert.ok(parsed.error);
      assert.ok(parsed.error.includes("at least 10"));
    });

    it("rejects empty emojis", async () => {
      const tool = createGenerateQuestionTool(data);
      const result = await tool.handler(
        {
          topic: "Science",
          statement: "A valid statement that is long enough",
          isTrue: true,
          emojis: [],
        },
        SESSION,
      );
      const parsed = parseResult(result);
      assert.ok(parsed.error);
      assert.ok(parsed.error.includes("1-4 emojis"));
    });

    it("rejects duplicate topic within dedup window", async () => {
      await data.saveQuestion({
        id: "q1",
        topic: "Science",
        statement: "Some science statement here",
        isTrue: true,
        emojis: ["🔬"],
        createdAt: 1,
      });

      const tool = createGenerateQuestionTool(data);
      const result = await tool.handler(
        {
          topic: "Science",
          statement: "Another science statement that is long enough",
          isTrue: false,
          emojis: ["🧪"],
        },
        SESSION,
      );
      const parsed = parseResult(result);
      assert.ok(parsed.error);
      assert.ok(parsed.error.includes("was used in the last"));
    });

    it("topic dedup is case-insensitive", async () => {
      await data.saveQuestion({
        id: "q1",
        topic: "science",
        statement: "Some science statement here",
        isTrue: true,
        emojis: ["🔬"],
        createdAt: 1,
      });

      const tool = createGenerateQuestionTool(data);
      const result = await tool.handler(
        {
          topic: "SCIENCE",
          statement: "Another science statement that is long enough",
          isTrue: false,
          emojis: ["🧪"],
        },
        SESSION,
      );
      const parsed = parseResult(result);
      assert.ok(parsed.error);
    });
  });

  // -------------------------------------------------------------------------
  // register_user
  // -------------------------------------------------------------------------

  describe("register_user", () => {
    it("registers a new user", async () => {
      const tool = createRegisterUserTool(data);
      const result = await tool.handler({ userId: "U123", displayName: "Alice" }, SESSION);
      const parsed = parseResult(result);
      assert.equal(parsed.userId, "U123");
      assert.equal(parsed.displayName, "Alice");
      assert.equal(parsed.updated, false);
    });

    it("updates display name for existing user", async () => {
      await data.saveUser({
        userId: "U123",
        displayName: "Alice",
        joinedAt: 100,
      });

      const tool = createRegisterUserTool(data);
      const result = await tool.handler({ userId: "U123", displayName: "Alice B." }, SESSION);
      const parsed = parseResult(result);
      assert.equal(parsed.displayName, "Alice B.");
      assert.equal(parsed.updated, true);
      assert.equal(parsed.joinedAt, 100); // preserves original joinedAt
    });
  });

  // -------------------------------------------------------------------------
  // submit_answer
  // -------------------------------------------------------------------------

  describe("submit_answer", () => {
    beforeEach(async () => {
      await data.saveUser({ userId: "U1", displayName: "Alice", joinedAt: 1 });
      await data.saveQuestion({
        id: "q1",
        topic: "Science",
        statement: "Water boils at 100C at sea level",
        isTrue: true,
        emojis: ["🔬"],
        createdAt: 1,
      });
    });

    it("accepts a correct answer", async () => {
      const tool = createSubmitAnswerTool(data);
      const result = await tool.handler({ userId: "U1", questionId: "q1", answer: true }, SESSION);
      const parsed = parseResult(result);
      assert.equal(parsed.correct, true);
      assert.equal(parsed.totalCorrect, 1);
      assert.equal(parsed.totalAnswered, 1);
    });

    it("accepts an incorrect answer", async () => {
      const tool = createSubmitAnswerTool(data);
      const result = await tool.handler({ userId: "U1", questionId: "q1", answer: false }, SESSION);
      const parsed = parseResult(result);
      assert.equal(parsed.correct, false);
      assert.equal(parsed.correctAnswer, true);
    });

    it("rejects unregistered user", async () => {
      const tool = createSubmitAnswerTool(data);
      const result = await tool.handler(
        { userId: "UXXX", questionId: "q1", answer: true },
        SESSION,
      );
      const parsed = parseResult(result);
      assert.ok(parsed.error);
      assert.ok(parsed.error.includes("not registered"));
    });

    it("rejects unknown question", async () => {
      const tool = createSubmitAnswerTool(data);
      const result = await tool.handler(
        { userId: "U1", questionId: "nope", answer: true },
        SESSION,
      );
      const parsed = parseResult(result);
      assert.ok(parsed.error);
      assert.ok(parsed.error.includes("not found"));
    });

    it("prevents duplicate submissions", async () => {
      const tool = createSubmitAnswerTool(data);
      await tool.handler({ userId: "U1", questionId: "q1", answer: true }, SESSION);
      const result = await tool.handler({ userId: "U1", questionId: "q1", answer: false }, SESSION);
      const parsed = parseResult(result);
      assert.ok(parsed.error);
      assert.ok(parsed.error.includes("already answered"));
    });

    it("tracks streak correctly", async () => {
      await data.saveQuestion({
        id: "q2",
        topic: "History",
        statement: "Rome was founded in 753 BC according to tradition",
        isTrue: true,
        emojis: ["🏛️"],
        createdAt: 2,
      });

      const tool = createSubmitAnswerTool(data);

      // Answer q1 correctly
      const r1 = await tool.handler({ userId: "U1", questionId: "q1", answer: true }, SESSION);
      assert.equal(parseResult(r1).currentStreak, 1);

      // Answer q2 correctly
      const r2 = await tool.handler({ userId: "U1", questionId: "q2", answer: true }, SESSION);
      assert.equal(parseResult(r2).currentStreak, 2);
    });
  });

  // -------------------------------------------------------------------------
  // retrieve_scores
  // -------------------------------------------------------------------------

  describe("retrieve_scores", () => {
    it("returns empty leaderboard when no answers exist", async () => {
      const tool = createRetrieveScoresTool(data);
      const result = await tool.handler({ limit: undefined }, SESSION);
      const parsed = parseResult(result);
      assert.deepEqual(parsed.leaderboard, []);
      assert.equal(parsed.totalPlayers, 0);
    });

    it("returns ranked leaderboard", async () => {
      await data.saveUser({ userId: "U1", displayName: "Alice", joinedAt: 1 });
      await data.saveUser({ userId: "U2", displayName: "Bob", joinedAt: 2 });

      // Alice: 2 correct, 1 wrong
      await data.saveAnswer({
        userId: "U1",
        questionId: "q1",
        answer: true,
        correct: true,
        timestamp: 1,
      });
      await data.saveAnswer({
        userId: "U1",
        questionId: "q2",
        answer: true,
        correct: true,
        timestamp: 2,
      });
      await data.saveAnswer({
        userId: "U1",
        questionId: "q3",
        answer: false,
        correct: false,
        timestamp: 3,
      });

      // Bob: 1 correct, 0 wrong
      await data.saveAnswer({
        userId: "U2",
        questionId: "q1",
        answer: true,
        correct: true,
        timestamp: 4,
      });

      const tool = createRetrieveScoresTool(data);
      const result = await tool.handler({ limit: undefined }, SESSION);
      const parsed = parseResult(result);

      assert.equal(parsed.leaderboard.length, 2);
      assert.equal(parsed.leaderboard[0].displayName, "Alice"); // 2 correct > 1
      assert.equal(parsed.leaderboard[0].totalCorrect, 2);
      assert.equal(parsed.leaderboard[0].accuracy, 67);
      assert.equal(parsed.leaderboard[1].displayName, "Bob");
      assert.equal(parsed.leaderboard[1].totalCorrect, 1);
      assert.equal(parsed.leaderboard[1].accuracy, 100);
    });

    it("respects limit", async () => {
      await data.saveUser({ userId: "U1", displayName: "Alice", joinedAt: 1 });
      await data.saveUser({ userId: "U2", displayName: "Bob", joinedAt: 2 });
      await data.saveAnswer({
        userId: "U1",
        questionId: "q1",
        answer: true,
        correct: true,
        timestamp: 1,
      });
      await data.saveAnswer({
        userId: "U2",
        questionId: "q1",
        answer: true,
        correct: true,
        timestamp: 2,
      });

      const tool = createRetrieveScoresTool(data);
      const result = await tool.handler({ limit: 1 }, SESSION);
      const parsed = parseResult(result);
      assert.equal(parsed.leaderboard.length, 1);
    });
  });
});
