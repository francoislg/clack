import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createInMemoryDataLayer } from "./testHelpers.js";
import { createAddCategoriesTool } from "./addCategories.js";
import { createRemoveCategoriesTool } from "./removeCategories.js";
import { createGetIdeasTool } from "./getIdeas.js";
import { createSaveQuestionTool } from "./saveQuestion.js";
import { createFindPreviousQuestionsTool } from "./findPreviousQuestions.js";
import { createSubmitAnswersTool } from "./submitAnswers.js";
import { createRetrieveScoresTool } from "./retrieveScores.js";
import { SEED_CATEGORIES } from "./seedCategories.js";
import type { TriviaDataLayer, TriviaQuestion } from "./types.js";

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
  // 7.1 Seed Categories
  // -------------------------------------------------------------------------

  describe("seed categories", () => {
    it("has exactly 50 entries", () => {
      assert.equal(SEED_CATEGORIES.length, 50);
    });

    it("all entries are unique", () => {
      const lower = SEED_CATEGORIES.map((c) => c.toLowerCase());
      const unique = new Set(lower);
      assert.equal(unique.size, SEED_CATEGORIES.length);
    });

    it("all entries are non-empty strings", () => {
      for (const category of SEED_CATEGORIES) {
        assert.ok(typeof category === "string");
        assert.ok(category.length > 0);
      }
    });
  });

  // -------------------------------------------------------------------------
  // 7.2 add_categories and remove_categories
  // -------------------------------------------------------------------------

  describe("add_categories", () => {
    beforeEach(async () => {
      await data.saveCategories(["Science", "History", "Geography"]);
    });

    it("adds new categories", async () => {
      const tool = createAddCategoriesTool(data);
      const result = await tool.handler({ categories: ["Art", "Music"] }, SESSION);
      const parsed = parseResult(result);

      assert.deepEqual(parsed.added, ["Art", "Music"]);
      assert.deepEqual(parsed.alreadyExists, []);
      assert.equal(parsed.total, 5);

      const categories = await data.loadCategories();
      assert.ok(categories.includes("Art"));
      assert.ok(categories.includes("Music"));
    });

    it("deduplicates existing categories (case-insensitive)", async () => {
      const tool = createAddCategoriesTool(data);
      const result = await tool.handler({ categories: ["science", "HISTORY", "NewOne"] }, SESSION);
      const parsed = parseResult(result);

      assert.deepEqual(parsed.added, ["NewOne"]);
      assert.deepEqual(parsed.alreadyExists, ["science", "HISTORY"]);
      assert.equal(parsed.total, 4);
    });

    it("returns correct totals when mixing new and existing", async () => {
      const tool = createAddCategoriesTool(data);
      const result = await tool.handler({ categories: ["Science", "Novel1", "Novel2"] }, SESSION);
      const parsed = parseResult(result);

      assert.equal(parsed.added.length, 2);
      assert.equal(parsed.alreadyExists.length, 1);
      assert.equal(parsed.total, 5);
    });
  });

  describe("remove_categories", () => {
    beforeEach(async () => {
      await data.saveCategories(["Science", "History", "Geography"]);
    });

    it("removes categories by exact match (case-insensitive)", async () => {
      const tool = createRemoveCategoriesTool(data);
      const result = await tool.handler({ categories: ["science", "HISTORY"] }, SESSION);
      const parsed = parseResult(result);

      assert.equal(parsed.removed.length, 2);
      assert.ok(parsed.removed.includes("Science") || parsed.removed.includes("science"));
      assert.deepEqual(parsed.notFound, []);
      assert.equal(parsed.total, 1);

      const categories = await data.loadCategories();
      assert.equal(categories.length, 1);
      assert.equal(categories[0], "Geography");
    });

    it("reports not found for non-existent categories", async () => {
      const tool = createRemoveCategoriesTool(data);
      const result = await tool.handler({ categories: ["Unknown", "Missing"] }, SESSION);
      const parsed = parseResult(result);

      assert.deepEqual(parsed.removed, []);
      assert.deepEqual(parsed.notFound, ["Unknown", "Missing"]);
      assert.equal(parsed.total, 3);
    });

    it("handles mixed removal (some exist, some don't)", async () => {
      const tool = createRemoveCategoriesTool(data);
      const result = await tool.handler({ categories: ["Science", "Unknown"] }, SESSION);
      const parsed = parseResult(result);

      assert.equal(parsed.removed.length, 1);
      assert.equal(parsed.notFound.length, 1);
      assert.equal(parsed.total, 2);
    });
  });

  // -------------------------------------------------------------------------
  // 7.3 get_ideas
  // -------------------------------------------------------------------------

  describe("get_ideas", () => {
    beforeEach(async () => {
      await data.saveCategories([
        "Science",
        "History",
        "Geography",
        "Art",
        "Music",
        "Technology",
        "Sports",
        "Literature",
        "Philosophy",
        "Economics",
      ]);
    });

    it("returns up to 5 random categories", async () => {
      const tool = createGetIdeasTool(data);
      const result = await tool.handler({}, SESSION);
      const parsed = parseResult(result);

      assert.ok(Array.isArray(parsed.ideas));
      assert.ok(parsed.ideas.length <= 5);
      assert.ok(parsed.ideas.length > 0);
    });

    it("excludes categories used in last 10 questions", async () => {
      // Add 5 recent questions
      for (let i = 0; i < 5; i++) {
        await data.saveQuestion({
          id: `q${i}`,
          category: ["Science", "History", "Geography", "Art", "Music"][i],
          statement: "A statement that is definitely long enough to pass validation",
          isTrue: true,
          emojis: ["🎯"],
          createdAt: i,
        });
      }

      const tool = createGetIdeasTool(data);
      const result = await tool.handler({}, SESSION);
      const parsed = parseResult(result);

      // Should exclude the 5 recent categories and pick from the remaining 5
      for (const idea of parsed.ideas) {
        assert.ok(
          !["Science", "History", "Geography", "Art", "Music"].includes(idea),
          `${idea} should not be in recent categories`,
        );
      }
    });

    it("returns fewer ideas when pool is small after exclusions", async () => {
      // Add 9 questions (more than 5, ensuring exclusion of all but 1)
      const categories = [
        "Science",
        "History",
        "Geography",
        "Art",
        "Music",
        "Technology",
        "Sports",
        "Literature",
        "Philosophy",
      ];
      for (let i = 0; i < 9; i++) {
        await data.saveQuestion({
          id: `q${i}`,
          category: categories[i],
          statement: "A statement that is definitely long enough to pass validation",
          isTrue: true,
          emojis: ["🎯"],
          createdAt: i,
        });
      }

      const tool = createGetIdeasTool(data);
      const result = await tool.handler({}, SESSION);
      const parsed = parseResult(result);

      // Only 1 category should be available (Economics is the only one not in last 10)
      assert.equal(parsed.ideas.length, 1);
      assert.equal(parsed.ideas[0], "Economics");
    });
  });

  // -------------------------------------------------------------------------
  // 7.4 save_question
  // -------------------------------------------------------------------------

  describe("save_question", () => {
    beforeEach(async () => {
      await data.saveCategories(["Science", "History"]);
    });

    it("saves a valid question", async () => {
      const tool = createSaveQuestionTool(data);
      const result = await tool.handler(
        {
          category: "Science",
          statement: "Water boils at 100 degrees Celsius at sea level",
          isTrue: true,
          emojis: ["🔬"],
        },
        SESSION,
      );
      const parsed = parseResult(result);

      assert.equal(parsed.saved, true);
      assert.ok(parsed.question.id);
      assert.equal(parsed.question.category, "Science");
      assert.equal(parsed.question.statement, "Water boils at 100 degrees Celsius at sea level");
      assert.equal(parsed.question.isTrue, true);

      const questions = await data.loadQuestions();
      assert.equal(questions.length, 1);
    });

    it("uses case-insensitive category match", async () => {
      const tool = createSaveQuestionTool(data);
      const result = await tool.handler(
        {
          category: "science",
          statement: "This is a long enough statement to test",
          isTrue: true,
          emojis: ["🔬"],
        },
        SESSION,
      );
      const parsed = parseResult(result);

      assert.equal(parsed.saved, true);
      assert.equal(parsed.question.category, "Science");
    });

    it("rejects category not in pool", async () => {
      const tool = createSaveQuestionTool(data);
      const result = await tool.handler(
        {
          category: "NonExistent",
          statement: "This is a long enough statement to test",
          isTrue: true,
          emojis: ["🔬"],
        },
        SESSION,
      );
      const parsed = parseResult(result);

      assert.ok(parsed.error);
      assert.ok(parsed.error.includes("not found"));
      assert.ok(parsed.error.includes("add_categories"));
    });

    it("rejects statement shorter than 10 characters", async () => {
      const tool = createSaveQuestionTool(data);
      const result = await tool.handler(
        {
          category: "Science",
          statement: "Short",
          isTrue: true,
          emojis: ["🔬"],
        },
        SESSION,
      );
      const parsed = parseResult(result);

      assert.ok(parsed.error);
      assert.ok(parsed.error.includes("at least 10"));
    });

    it("rejects statement longer than 500 characters", async () => {
      const longStatement = "a".repeat(501);
      const tool = createSaveQuestionTool(data);
      const result = await tool.handler(
        {
          category: "Science",
          statement: longStatement,
          isTrue: true,
          emojis: ["🔬"],
        },
        SESSION,
      );
      const parsed = parseResult(result);

      assert.ok(parsed.error);
      assert.ok(parsed.error.includes("at most 500"));
    });

    it("rejects empty emoji list", async () => {
      const tool = createSaveQuestionTool(data);
      const result = await tool.handler(
        {
          category: "Science",
          statement: "This is a long enough statement",
          isTrue: true,
          emojis: [],
        },
        SESSION,
      );
      const parsed = parseResult(result);

      assert.ok(parsed.error);
      assert.ok(parsed.error.includes("1-4 emojis"));
    });

    it("rejects emoji list with more than 4 emojis", async () => {
      const tool = createSaveQuestionTool(data);
      const result = await tool.handler(
        {
          category: "Science",
          statement: "This is a long enough statement",
          isTrue: true,
          emojis: ["🔬", "🧪", "⚗️", "🧬", "🔭"],
        },
        SESSION,
      );
      const parsed = parseResult(result);

      assert.ok(parsed.error);
      assert.ok(parsed.error.includes("1-4 emojis"));
    });

    it("accepts exactly 1 emoji", async () => {
      const tool = createSaveQuestionTool(data);
      const result = await tool.handler(
        {
          category: "Science",
          statement: "This is a long enough statement",
          isTrue: true,
          emojis: ["🔬"],
        },
        SESSION,
      );
      const parsed = parseResult(result);

      assert.equal(parsed.saved, true);
    });

    it("accepts exactly 4 emojis", async () => {
      const tool = createSaveQuestionTool(data);
      const result = await tool.handler(
        {
          category: "Science",
          statement: "This is a long enough statement",
          isTrue: true,
          emojis: ["🔬", "🧪", "⚗️", "🧬"],
        },
        SESSION,
      );
      const parsed = parseResult(result);

      assert.equal(parsed.saved, true);
    });
  });

  // -------------------------------------------------------------------------
  // 7.5 find_previous_questions
  // -------------------------------------------------------------------------

  describe("find_previous_questions", () => {
    beforeEach(async () => {
      await data.saveQuestion({
        id: "q1",
        category: "Science",
        statement: "Water boils at 100 degrees Celsius",
        isTrue: true,
        emojis: ["🔬"],
        createdAt: 1,
      });
      await data.saveQuestion({
        id: "q2",
        category: "Science",
        statement: "The Earth is flat",
        isTrue: false,
        emojis: ["🌍"],
        createdAt: 2,
      });
      await data.saveQuestion({
        id: "q3",
        category: "History",
        statement: "Rome was founded in 753 BC",
        isTrue: true,
        emojis: ["🏛️"],
        createdAt: 3,
      });
    });

    it("searches by category only", async () => {
      const tool = createFindPreviousQuestionsTool(data);
      const result = await tool.handler(
        { category: "Science", text: undefined, limit: undefined },
        SESSION,
      );
      const parsed = parseResult(result);

      assert.equal(parsed.count, 2);
      assert.ok(parsed.questions.every((q: TriviaQuestion) => q.category === "Science"));
    });

    it("searches by text only", async () => {
      const tool = createFindPreviousQuestionsTool(data);
      const result = await tool.handler(
        { category: undefined, text: "boils", limit: undefined },
        SESSION,
      );
      const parsed = parseResult(result);

      assert.equal(parsed.count, 1);
      assert.equal(parsed.questions[0].id, "q1");
    });

    it("searches by both category and text (AND)", async () => {
      const tool = createFindPreviousQuestionsTool(data);
      const result = await tool.handler(
        { category: "Science", text: "Earth", limit: undefined },
        SESSION,
      );
      const parsed = parseResult(result);

      assert.equal(parsed.count, 1);
      assert.equal(parsed.questions[0].id, "q2");
    });

    it("returns no results when both filters exclude all questions", async () => {
      const tool = createFindPreviousQuestionsTool(data);
      const result = await tool.handler(
        { category: "Science", text: "Rome", limit: undefined },
        SESSION,
      );
      const parsed = parseResult(result);

      assert.equal(parsed.count, 0);
      assert.deepEqual(parsed.questions, []);
    });

    it("is case-insensitive for category", async () => {
      const tool = createFindPreviousQuestionsTool(data);
      const result = await tool.handler(
        { category: "science", text: undefined, limit: undefined },
        SESSION,
      );
      const parsed = parseResult(result);

      assert.equal(parsed.count, 2);
    });

    it("is case-insensitive for text", async () => {
      const tool = createFindPreviousQuestionsTool(data);
      const result = await tool.handler(
        { category: undefined, text: "EARTH", limit: undefined },
        SESSION,
      );
      const parsed = parseResult(result);

      assert.equal(parsed.count, 1);
    });

    it("returns all questions when neither category nor text is provided (up to limit)", async () => {
      const tool = createFindPreviousQuestionsTool(data);
      const result = await tool.handler(
        { category: undefined, text: undefined, limit: undefined },
        SESSION,
      );
      const parsed = parseResult(result);

      assert.equal(parsed.error, undefined);
      assert.ok(parsed.count >= 1);
    });
  });

  // -------------------------------------------------------------------------
  // 7.6 submit_answers
  // -------------------------------------------------------------------------

  describe("submit_answers", () => {
    beforeEach(async () => {
      await data.saveQuestion({
        id: "q1",
        category: "Science",
        statement: "Water boils at 100 degrees Celsius",
        isTrue: true,
        emojis: ["🔬"],
        createdAt: 1,
      });
    });

    it("batch saves multiple answers", async () => {
      const tool = createSubmitAnswersTool(data);
      const result = await tool.handler(
        {
          questionId: "q1",
          messageLink: "https://slack.com/archives/C123/p456",
          postedAt: 1000,
          answers: [
            { userId: "U1", displayName: "Alice", answer: true },
            { userId: "U2", displayName: "Bob", answer: false },
          ],
        },
        SESSION,
      );
      const parsed = parseResult(result);

      assert.equal(parsed.results.length, 2);
      assert.equal(parsed.results[0].userId, "U1");
      assert.equal(parsed.results[0].correct, true);
      assert.equal(parsed.results[0].totalCorrect, 1);
      assert.equal(parsed.results[0].totalAnswered, 1);

      assert.equal(parsed.results[1].userId, "U2");
      assert.equal(parsed.results[1].correct, false);
      assert.equal(parsed.results[1].totalCorrect, 0);
      assert.equal(parsed.results[1].totalAnswered, 1);
    });

    it("auto-registers new users", async () => {
      const tool = createSubmitAnswersTool(data);
      await tool.handler(
        {
          questionId: "q1",
          messageLink: "https://slack.com/archives/C123/p456",
          postedAt: 1000,
          answers: [{ userId: "U123", displayName: "Charlie", answer: true }],
        },
        SESSION,
      );

      const users = await data.loadUsers();
      assert.ok(users.has("U123"));
      const user = users.get("U123");
      assert.equal(user?.displayName, "Charlie");
    });

    it("skips duplicate answers", async () => {
      const tool = createSubmitAnswersTool(data);

      // First submission
      await tool.handler(
        {
          questionId: "q1",
          messageLink: "https://slack.com/archives/C123/p456",
          postedAt: 1000,
          answers: [{ userId: "U1", displayName: "Alice", answer: true }],
        },
        SESSION,
      );

      // Second submission with same user/question
      const result = await tool.handler(
        {
          questionId: "q1",
          messageLink: "https://slack.com/archives/C123/p456",
          postedAt: 1000,
          answers: [{ userId: "U1", displayName: "Alice", answer: false }],
        },
        SESSION,
      );
      const parsed = parseResult(result);

      assert.equal(parsed.results[0].skipped, true);

      // Only one answer should be saved
      const answers = await data.loadAnswers();
      const userAnswers = answers.filter((a) => a.userId === "U1");
      assert.equal(userAnswers.length, 1);
      assert.equal(userAnswers[0].answer, true); // Original answer unchanged
    });

    it("stamps question with postedAt/messageLink on first submission", async () => {
      const tool = createSubmitAnswersTool(data);
      const messageLink = "https://slack.com/archives/C123/p456";
      const postedAt = 1000;

      await tool.handler(
        {
          questionId: "q1",
          messageLink,
          postedAt,
          answers: [{ userId: "U1", displayName: "Alice", answer: true }],
        },
        SESSION,
      );

      const questions = await data.loadQuestions();
      const question = questions.find((q) => q.id === "q1");
      assert.equal(question?.messageLink, messageLink);
      assert.equal(question?.postedAt, postedAt);
    });

    it("does NOT overwrite postedAt on subsequent submissions", async () => {
      const tool = createSubmitAnswersTool(data);
      const originalLink = "https://slack.com/archives/C123/p456";
      const originalPostedAt = 1000;

      // First submission
      await tool.handler(
        {
          questionId: "q1",
          messageLink: originalLink,
          postedAt: originalPostedAt,
          answers: [{ userId: "U1", displayName: "Alice", answer: true }],
        },
        SESSION,
      );

      // Second submission
      await tool.handler(
        {
          questionId: "q1",
          messageLink: "https://different.com",
          postedAt: 2000,
          answers: [{ userId: "U2", displayName: "Bob", answer: true }],
        },
        SESSION,
      );

      const questions = await data.loadQuestions();
      const question = questions.find((q) => q.id === "q1");
      assert.equal(question?.messageLink, originalLink);
      assert.equal(question?.postedAt, originalPostedAt);
    });

    it("computes currentStreak correctly", async () => {
      // Add a second question
      await data.saveQuestion({
        id: "q2",
        category: "History",
        statement: "Rome was founded in 753 BC",
        isTrue: true,
        emojis: ["🏛️"],
        createdAt: 2,
      });

      const tool = createSubmitAnswersTool(data);

      // First answer correct
      const r1 = await tool.handler(
        {
          questionId: "q1",
          messageLink: "https://slack.com/archives/C123/p456",
          postedAt: 1000,
          answers: [{ userId: "U1", displayName: "Alice", answer: true }],
        },
        SESSION,
      );
      assert.equal(parseResult(r1).results[0].currentStreak, 1);

      // Second answer correct
      const r2 = await tool.handler(
        {
          questionId: "q2",
          messageLink: "https://slack.com/archives/C123/p789",
          postedAt: 2000,
          answers: [{ userId: "U1", displayName: "Alice", answer: true }],
        },
        SESSION,
      );
      assert.equal(parseResult(r2).results[0].currentStreak, 2);
    });

    it("resets currentStreak on incorrect answer", async () => {
      // Add a second question
      await data.saveQuestion({
        id: "q2",
        category: "History",
        statement: "Rome was founded in 753 BC",
        isTrue: false, // False this time
        emojis: ["🏛️"],
        createdAt: 2,
      });

      const tool = createSubmitAnswersTool(data);

      // First answer correct
      await tool.handler(
        {
          questionId: "q1",
          messageLink: "https://slack.com/archives/C123/p456",
          postedAt: 1000,
          answers: [{ userId: "U1", displayName: "Alice", answer: true }],
        },
        SESSION,
      );

      // Second answer incorrect
      const r2 = await tool.handler(
        {
          questionId: "q2",
          messageLink: "https://slack.com/archives/C123/p789",
          postedAt: 2000,
          answers: [{ userId: "U1", displayName: "Alice", answer: true }],
        },
        SESSION,
      );
      assert.equal(parseResult(r2).results[0].currentStreak, 0);
    });
  });

  // -------------------------------------------------------------------------
  // 7.7 retrieve_scores
  // -------------------------------------------------------------------------

  describe("retrieve_scores", () => {
    it("returns empty leaderboard when no answers exist", async () => {
      const tool = createRetrieveScoresTool(data);
      const result = await tool.handler({ limit: undefined }, SESSION);
      const parsed = parseResult(result);

      assert.deepEqual(parsed.leaderboard, []);
      assert.equal(parsed.totalPlayers, 0);
    });

    it("returns ranked leaderboard sorted by correctness", async () => {
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
      assert.equal(parsed.leaderboard[0].displayName, "Alice");
      assert.equal(parsed.leaderboard[0].totalCorrect, 2);
      assert.equal(parsed.leaderboard[0].accuracy, 67);
      assert.equal(parsed.leaderboard[1].displayName, "Bob");
      assert.equal(parsed.leaderboard[1].totalCorrect, 1);
      assert.equal(parsed.leaderboard[1].accuracy, 100);
    });

    it("respects limit parameter", async () => {
      await data.saveUser({ userId: "U1", displayName: "Alice", joinedAt: 1 });
      await data.saveUser({ userId: "U2", displayName: "Bob", joinedAt: 2 });
      await data.saveUser({ userId: "U3", displayName: "Charlie", joinedAt: 3 });

      for (let i = 1; i <= 3; i++) {
        await data.saveAnswer({
          userId: `U${i}`,
          questionId: "q1",
          answer: true,
          correct: true,
          timestamp: i,
        });
      }

      const tool = createRetrieveScoresTool(data);
      const result = await tool.handler({ limit: 2 }, SESSION);
      const parsed = parseResult(result);

      assert.equal(parsed.leaderboard.length, 2);
    });

    it("calculates accuracy percentage correctly", async () => {
      await data.saveUser({ userId: "U1", displayName: "Alice", joinedAt: 1 });

      // 3 correct, 1 wrong = 75% accuracy
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
        answer: true,
        correct: true,
        timestamp: 3,
      });
      await data.saveAnswer({
        userId: "U1",
        questionId: "q4",
        answer: true,
        correct: false,
        timestamp: 4,
      });

      const tool = createRetrieveScoresTool(data);
      const result = await tool.handler({ limit: undefined }, SESSION);
      const parsed = parseResult(result);

      assert.equal(parsed.leaderboard[0].accuracy, 75);
    });

    it("rounds accuracy correctly", async () => {
      await data.saveUser({ userId: "U1", displayName: "Alice", joinedAt: 1 });

      // 1 correct, 2 wrong = 33.33...% accuracy, should round to 33
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
        correct: false,
        timestamp: 2,
      });
      await data.saveAnswer({
        userId: "U1",
        questionId: "q3",
        answer: true,
        correct: false,
        timestamp: 3,
      });

      const tool = createRetrieveScoresTool(data);
      const result = await tool.handler({ limit: undefined }, SESSION);
      const parsed = parseResult(result);

      const accuracy = parsed.leaderboard[0].accuracy;
      assert.ok(accuracy === 33 || accuracy === 34); // Allow for rounding variance
    });
  });
});
