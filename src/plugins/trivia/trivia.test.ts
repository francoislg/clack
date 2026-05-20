import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createInMemoryDataLayer, FIXTURE_GAME_NAME, fixtureGetGames } from "./testHelpers.js";
import { createAddCategoriesTool } from "./tools/categories/addCategories.js";
import { createRemoveCategoriesTool } from "./tools/categories/removeCategories.js";
import { createGetIdeasTool } from "./tools/questions/getIdeas.js";
import { createSaveQuestionTool } from "./tools/questions/saveQuestion.js";
import { createFindPreviousQuestionsTool } from "./tools/questions/findPreviousQuestions.js";
import { createSubmitAnswersTool } from "./tools/answers/submitAnswers.js";
import { createRetrieveScoresTool } from "./tools/answers/retrieveScores.js";
import { SEED_CATEGORIES } from "./core/seedCategories.js";
import { parseToolResult } from "../../tools/testHelpers.js";
import type { TriviaDataLayer, TriviaQuestion } from "./core/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
      const tool = createAddCategoriesTool(data, fixtureGetGames);
      const result = await tool.handler(
        { game: FIXTURE_GAME_NAME, target: undefined, categories: ["Art", "Music"] },
        SESSION,
      );
      const parsed = parseToolResult(result);

      assert.deepEqual(parsed.added, ["Art", "Music"]);
      assert.deepEqual(parsed.alreadyExists, []);
      assert.equal(parsed.total, 5);

      const categories = await data.loadCategories();
      assert.ok(categories.includes("Art"));
      assert.ok(categories.includes("Music"));
    });

    it("deduplicates existing categories (case-insensitive)", async () => {
      const tool = createAddCategoriesTool(data, fixtureGetGames);
      const result = await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
          target: undefined,
          categories: ["science", "HISTORY", "NewOne"],
        },
        SESSION,
      );
      const parsed = parseToolResult(result);

      assert.deepEqual(parsed.added, ["NewOne"]);
      assert.deepEqual(parsed.alreadyExists, ["science", "HISTORY"]);
      assert.equal(parsed.total, 4);
    });

    it("returns correct totals when mixing new and existing", async () => {
      const tool = createAddCategoriesTool(data, fixtureGetGames);
      const result = await tool.handler(
        { game: FIXTURE_GAME_NAME, target: undefined, categories: ["Science", "Novel1", "Novel2"] },
        SESSION,
      );
      const parsed = parseToolResult(result);

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
      const tool = createRemoveCategoriesTool(data, fixtureGetGames);
      const result = await tool.handler(
        { game: FIXTURE_GAME_NAME, target: undefined, categories: ["science", "HISTORY"] },
        SESSION,
      );
      const parsed = parseToolResult(result);

      assert.equal(parsed.removed.length, 2);
      assert.ok(parsed.removed.includes("Science") || parsed.removed.includes("science"));
      assert.deepEqual(parsed.notFound, []);
      assert.equal(parsed.total, 1);

      const categories = await data.loadCategories();
      assert.equal(categories.length, 1);
      assert.equal(categories[0], "Geography");
    });

    it("reports not found for non-existent categories", async () => {
      const tool = createRemoveCategoriesTool(data, fixtureGetGames);
      const result = await tool.handler(
        { game: FIXTURE_GAME_NAME, target: undefined, categories: ["Unknown", "Missing"] },
        SESSION,
      );
      const parsed = parseToolResult(result);

      assert.deepEqual(parsed.removed, []);
      assert.deepEqual(parsed.notFound, ["Unknown", "Missing"]);
      assert.equal(parsed.total, 3);
    });

    it("handles mixed removal (some exist, some don't)", async () => {
      const tool = createRemoveCategoriesTool(data, fixtureGetGames);
      const result = await tool.handler(
        { game: FIXTURE_GAME_NAME, target: undefined, categories: ["Science", "Unknown"] },
        SESSION,
      );
      const parsed = parseToolResult(result);

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

    it("returns up to 5 random categories with pool stats and suggestions", async () => {
      const tool = createGetIdeasTool(data, undefined, fixtureGetGames);
      const result = await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION);
      const parsed = parseToolResult(result);

      assert.ok(Array.isArray(parsed.categories.ideas));
      assert.ok(parsed.categories.ideas.length <= 5);
      assert.ok(parsed.categories.ideas.length > 0);
      assert.equal(parsed.categories.total, 10);
      assert.equal(parsed.categories.excluded, 0);
      assert.equal(typeof parsed.suggestedAnswer, "boolean");
      assert.ok(["Easy", "Medium", "Hard"].includes(parsed.suggestedDifficulty));
    });

    it("scales exclusion to min(10, floor(pool/3)) for the most recent questions", async () => {
      // Pool of 10 → exclusion window = min(10, 3) = 3. Saving 5 questions means only the
      // last 3 categories get excluded, not all 5.
      for (let i = 0; i < 5; i++) {
        await data.forGame(FIXTURE_GAME_NAME).saveQuestion({
          id: `q${i}`,
          category: ["Science", "History", "Geography", "Art", "Music"][i],
          statement: "A statement that is definitely long enough to pass validation",
          type: undefined,
          isTrue: true,
          choices: undefined,
          correctIndex: undefined,
          suggestedDifficulty: undefined,
          difficulty: undefined,
          slot: undefined,
          emojis: ["🎯"],
          createdAt: i,
        });
      }

      const tool = createGetIdeasTool(data, undefined, fixtureGetGames);
      const result = await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION);
      const parsed = parseToolResult(result);

      assert.equal(parsed.categories.excluded, 3);
      const excludedSet = new Set(["Geography", "Art", "Music"]);
      for (const idea of parsed.categories.ideas) {
        assert.ok(!excludedSet.has(idea), `${idea} should not be in the last-3 categories`);
      }
    });

    it("still emits ideas when all categories have been used (scaled window prevents deadlock)", async () => {
      // Pool of 10 → exclusion window = 3. Even with 9 questions, 7 categories remain eligible.
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
        await data.forGame(FIXTURE_GAME_NAME).saveQuestion({
          id: `q${i}`,
          category: categories[i],
          statement: "A statement that is definitely long enough to pass validation",
          type: undefined,
          isTrue: true,
          choices: undefined,
          correctIndex: undefined,
          suggestedDifficulty: undefined,
          difficulty: undefined,
          slot: undefined,
          emojis: ["🎯"],
          createdAt: i,
        });
      }

      const tool = createGetIdeasTool(data, undefined, fixtureGetGames);
      const result = await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION);
      const parsed = parseToolResult(result);

      assert.equal(parsed.categories.excluded, 3);
      assert.ok(parsed.categories.ideas.length > 0);
      assert.equal(typeof parsed.suggestedAnswer, "boolean");
      assert.ok(["Easy", "Medium", "Hard"].includes(parsed.suggestedDifficulty));
    });

    it("still emits ideas after every category has been asked at least once", async () => {
      const allCategories = [
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
      ];
      for (let i = 0; i < allCategories.length; i++) {
        await data.forGame(FIXTURE_GAME_NAME).saveQuestion({
          id: `q${i}`,
          category: allCategories[i],
          statement: "A statement that is definitely long enough to pass validation",
          type: undefined,
          isTrue: true,
          choices: undefined,
          correctIndex: undefined,
          suggestedDifficulty: undefined,
          difficulty: undefined,
          slot: undefined,
          emojis: ["🎯"],
          createdAt: i,
        });
      }

      const tool = createGetIdeasTool(data, undefined, fixtureGetGames);
      const result = await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION);
      const parsed = parseToolResult(result);

      // With scaled exclusion (pool=10 → window=3), only the last 3 categories are excluded
      // even after every category has been used. 7 remain eligible, so ideas are still emitted.
      assert.equal(parsed.categories.excluded, 3);
      assert.ok(parsed.categories.ideas.length > 0);
      assert.equal(typeof parsed.suggestedAnswer, "boolean");
      assert.ok(["Easy", "Medium", "Hard"].includes(parsed.suggestedDifficulty));
    });

    // Distribution tests use an empty category pool so the idea-pick loop
    // consumes zero Math.random() calls. Only the two suggestion picks remain:
    // [answer, difficulty]. This decouples the tests from internal call ordering.
    describe("suggestion distribution", () => {
      const originalRandom = Math.random;

      beforeEach(async () => {
        await data.saveCategories([]);
      });

      const stubRandomSequence = (values: number[]) => {
        let i = 0;
        Math.random = () => values[i++ % values.length];
      };

      const restore = () => {
        Math.random = originalRandom;
      };

      it("suggestedAnswer takes both values across calls", async () => {
        const tool = createGetIdeasTool(data, undefined, fixtureGetGames);
        try {
          // [answer=0.0, difficulty=0.0] → answer = (0.0 < 0.5) = true.
          stubRandomSequence([0.0, 0.0]);
          const a = parseToolResult(
            await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION),
          );
          assert.equal(a.suggestedAnswer, true);

          // [answer=0.99, difficulty=0.0] → answer = (0.99 < 0.5) = false.
          stubRandomSequence([0.99, 0.0]);
          const b = parseToolResult(
            await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION),
          );
          assert.equal(b.suggestedAnswer, false);
        } finally {
          restore();
        }
      });

      it("suggestedDifficulty buckets at 0.30 and 0.90 boundaries", async () => {
        const tool = createGetIdeasTool(data, undefined, fixtureGetGames);
        try {
          // [answer=0.0, difficulty=<value-under-test>].
          stubRandomSequence([0.0, 0.0]);
          assert.equal(
            parseToolResult(
              await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION),
            ).suggestedDifficulty,
            "Easy",
          );

          stubRandomSequence([0.0, 0.2999]);
          assert.equal(
            parseToolResult(
              await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION),
            ).suggestedDifficulty,
            "Easy",
          );

          stubRandomSequence([0.0, 0.3]);
          assert.equal(
            parseToolResult(
              await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION),
            ).suggestedDifficulty,
            "Medium",
          );

          stubRandomSequence([0.0, 0.8999]);
          assert.equal(
            parseToolResult(
              await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION),
            ).suggestedDifficulty,
            "Medium",
          );

          stubRandomSequence([0.0, 0.9]);
          assert.equal(
            parseToolResult(
              await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION),
            ).suggestedDifficulty,
            "Hard",
          );

          stubRandomSequence([0.0, 0.9999]);
          assert.equal(
            parseToolResult(
              await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION),
            ).suggestedDifficulty,
            "Hard",
          );
        } finally {
          restore();
        }
      });
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
      const tool = createSaveQuestionTool(data, undefined, fixtureGetGames);
      const result = await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
          category: "Science",
          statement: "Water boils at 100 degrees Celsius at sea level",
          type: undefined,
          isTrue: true,
          choices: undefined,
          correctIndex: undefined,
          suggestedDifficulty: undefined,
          difficulty: undefined,
          slot: undefined,
          emojis: ["🔬"],
        },
        SESSION,
      );
      const parsed = parseToolResult(result);

      assert.equal(parsed.saved, true);
      assert.ok(parsed.question.id);
      assert.equal(parsed.question.category, "Science");
      assert.equal(parsed.question.statement, "Water boils at 100 degrees Celsius at sea level");
      assert.equal(parsed.question.isTrue, true);

      const questions = await data.forGame(FIXTURE_GAME_NAME).loadQuestions();
      assert.equal(questions.length, 1);
    });

    it("uses case-insensitive category match", async () => {
      const tool = createSaveQuestionTool(data, undefined, fixtureGetGames);
      const result = await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
          category: "science",
          statement: "This is a long enough statement to test",
          type: undefined,
          isTrue: true,
          choices: undefined,
          correctIndex: undefined,
          suggestedDifficulty: undefined,
          difficulty: undefined,
          slot: undefined,
          emojis: ["🔬"],
        },
        SESSION,
      );
      const parsed = parseToolResult(result);

      assert.equal(parsed.saved, true);
      assert.equal(parsed.question.category, "Science");
    });

    it("rejects category not in pool", async () => {
      const tool = createSaveQuestionTool(data, undefined, fixtureGetGames);
      const result = await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
          category: "NonExistent",
          statement: "This is a long enough statement to test",
          type: undefined,
          isTrue: true,
          choices: undefined,
          correctIndex: undefined,
          suggestedDifficulty: undefined,
          difficulty: undefined,
          slot: undefined,
          emojis: ["🔬"],
        },
        SESSION,
      );
      const parsed = parseToolResult(result);

      assert.ok(parsed.error);
      assert.ok(parsed.error.includes("not found"));
      assert.ok(parsed.error.includes("add_categories"));
    });

    it("rejects statement shorter than 10 characters", async () => {
      const tool = createSaveQuestionTool(data, undefined, fixtureGetGames);
      const result = await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
          category: "Science",
          statement: "Short",
          type: undefined,
          isTrue: true,
          choices: undefined,
          correctIndex: undefined,
          suggestedDifficulty: undefined,
          difficulty: undefined,
          slot: undefined,
          emojis: ["🔬"],
        },
        SESSION,
      );
      const parsed = parseToolResult(result);

      assert.ok(parsed.error);
      assert.ok(parsed.error.includes("at least 10"));
    });

    it("rejects statement longer than 500 characters", async () => {
      const longStatement = "a".repeat(501);
      const tool = createSaveQuestionTool(data, undefined, fixtureGetGames);
      const result = await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
          category: "Science",
          statement: longStatement,
          type: undefined,
          isTrue: true,
          choices: undefined,
          correctIndex: undefined,
          suggestedDifficulty: undefined,
          difficulty: undefined,
          slot: undefined,
          emojis: ["🔬"],
        },
        SESSION,
      );
      const parsed = parseToolResult(result);

      assert.ok(parsed.error);
      assert.ok(parsed.error.includes("at most 500"));
    });

    it("rejects empty emoji list", async () => {
      const tool = createSaveQuestionTool(data, undefined, fixtureGetGames);
      const result = await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
          category: "Science",
          statement: "This is a long enough statement",
          type: undefined,
          isTrue: true,
          choices: undefined,
          correctIndex: undefined,
          suggestedDifficulty: undefined,
          difficulty: undefined,
          slot: undefined,
          emojis: [],
        },
        SESSION,
      );
      const parsed = parseToolResult(result);

      assert.ok(parsed.error);
      assert.ok(parsed.error.includes("1-4 emojis"));
    });

    it("rejects emoji list with more than 4 emojis", async () => {
      const tool = createSaveQuestionTool(data, undefined, fixtureGetGames);
      const result = await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
          category: "Science",
          statement: "This is a long enough statement",
          type: undefined,
          isTrue: true,
          choices: undefined,
          correctIndex: undefined,
          suggestedDifficulty: undefined,
          difficulty: undefined,
          slot: undefined,
          emojis: ["🔬", "🧪", "⚗️", "🧬", "🔭"],
        },
        SESSION,
      );
      const parsed = parseToolResult(result);

      assert.ok(parsed.error);
      assert.ok(parsed.error.includes("1-4 emojis"));
    });

    it("accepts exactly 1 emoji", async () => {
      const tool = createSaveQuestionTool(data, undefined, fixtureGetGames);
      const result = await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
          category: "Science",
          statement: "This is a long enough statement",
          type: undefined,
          isTrue: true,
          choices: undefined,
          correctIndex: undefined,
          suggestedDifficulty: undefined,
          difficulty: undefined,
          slot: undefined,
          emojis: ["🔬"],
        },
        SESSION,
      );
      const parsed = parseToolResult(result);

      assert.equal(parsed.saved, true);
    });

    it("accepts exactly 4 emojis", async () => {
      const tool = createSaveQuestionTool(data, undefined, fixtureGetGames);
      const result = await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
          category: "Science",
          statement: "This is a long enough statement",
          type: undefined,
          isTrue: true,
          choices: undefined,
          correctIndex: undefined,
          suggestedDifficulty: undefined,
          difficulty: undefined,
          slot: undefined,
          emojis: ["🔬", "🧪", "⚗️", "🧬"],
        },
        SESSION,
      );
      const parsed = parseToolResult(result);

      assert.equal(parsed.saved, true);
    });

    it("persists suggestedDifficulty and difficulty when provided", async () => {
      const tool = createSaveQuestionTool(data, undefined, fixtureGetGames);
      const result = await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
          category: "Science",
          statement: "Water boils at 100 degrees Celsius at sea level",
          type: undefined,
          isTrue: true,
          choices: undefined,
          correctIndex: undefined,
          suggestedDifficulty: "Medium",
          difficulty: 7,
          slot: undefined,
          emojis: ["🔬"],
        },
        SESSION,
      );
      const parsed = parseToolResult(result);

      assert.equal(parsed.saved, true);
      assert.equal(parsed.question.suggestedDifficulty, "Medium");
      assert.equal(parsed.question.difficulty, 7);

      const questions = await data.forGame(FIXTURE_GAME_NAME).loadQuestions();
      assert.equal(questions[0].suggestedDifficulty, "Medium");
      assert.equal(questions[0].difficulty, 7);
    });

    it("omits difficulty fields when not provided (legacy-compatible)", async () => {
      const tool = createSaveQuestionTool(data, undefined, fixtureGetGames);
      const result = await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
          category: "Science",
          statement: "Water boils at 100 degrees Celsius at sea level",
          type: undefined,
          isTrue: true,
          choices: undefined,
          correctIndex: undefined,
          suggestedDifficulty: undefined,
          difficulty: undefined,
          slot: undefined,
          emojis: ["🔬"],
        },
        SESSION,
      );
      const parsed = parseToolResult(result);

      assert.equal(parsed.saved, true);
      assert.equal(parsed.question.suggestedDifficulty, undefined);
      assert.equal(parsed.question.difficulty, undefined);
    });
  });

  // -------------------------------------------------------------------------
  // 7.5 find_previous_questions
  // -------------------------------------------------------------------------

  describe("find_previous_questions", () => {
    beforeEach(async () => {
      await data.forGame(FIXTURE_GAME_NAME).saveQuestion({
        id: "q1",
        category: "Science",
        statement: "Water boils at 100 degrees Celsius",
        isTrue: true,
        emojis: ["🔬"],
        createdAt: 1,
      });
      await data.forGame(FIXTURE_GAME_NAME).saveQuestion({
        id: "q2",
        category: "Science",
        statement: "The Earth is flat",
        isTrue: false,
        emojis: ["🌍"],
        createdAt: 2,
      });
      await data.forGame(FIXTURE_GAME_NAME).saveQuestion({
        id: "q3",
        category: "History",
        statement: "Rome was founded in 753 BC",
        isTrue: true,
        emojis: ["🏛️"],
        createdAt: 3,
      });
    });

    it("searches by category only", async () => {
      const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
      const result = await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
          category: "Science",
          text: undefined,
          season: undefined,
          recentBatchFromNow: undefined,
          limit: undefined,
        },
        SESSION,
      );
      const parsed = parseToolResult(result);

      assert.equal(parsed.count, 2);
      assert.ok(parsed.questions.every((q: TriviaQuestion) => q.category === "Science"));
    });

    it("searches by text only", async () => {
      const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
      const result = await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
          category: undefined,
          text: "boils",
          season: undefined,
          recentBatchFromNow: undefined,
          limit: undefined,
        },
        SESSION,
      );
      const parsed = parseToolResult(result);

      assert.equal(parsed.count, 1);
      assert.equal(parsed.questions[0].id, "q1");
    });

    it("searches by both category and text (AND)", async () => {
      const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
      const result = await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
          category: "Science",
          text: "Earth",
          season: undefined,
          recentBatchFromNow: undefined,
          limit: undefined,
        },
        SESSION,
      );
      const parsed = parseToolResult(result);

      assert.equal(parsed.count, 1);
      assert.equal(parsed.questions[0].id, "q2");
    });

    it("returns no results when both filters exclude all questions", async () => {
      const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
      const result = await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
          category: "Science",
          text: "Rome",
          season: undefined,
          recentBatchFromNow: undefined,
          limit: undefined,
        },
        SESSION,
      );
      const parsed = parseToolResult(result);

      assert.equal(parsed.count, 0);
      assert.deepEqual(parsed.questions, []);
    });

    it("is case-insensitive for category", async () => {
      const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
      const result = await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
          category: "science",
          text: undefined,
          season: undefined,
          recentBatchFromNow: undefined,
          limit: undefined,
        },
        SESSION,
      );
      const parsed = parseToolResult(result);

      assert.equal(parsed.count, 2);
    });

    it("is case-insensitive for text", async () => {
      const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
      const result = await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
          category: undefined,
          text: "EARTH",
          season: undefined,
          recentBatchFromNow: undefined,
          limit: undefined,
        },
        SESSION,
      );
      const parsed = parseToolResult(result);

      assert.equal(parsed.count, 1);
    });

    it("returns all questions when neither category nor text is provided (up to limit)", async () => {
      const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
      const result = await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
          category: undefined,
          text: undefined,
          season: undefined,
          recentBatchFromNow: undefined,
          limit: undefined,
        },
        SESSION,
      );
      const parsed = parseToolResult(result);

      assert.equal(parsed.error, undefined);
      assert.ok(parsed.count >= 1);
    });
  });

  // -------------------------------------------------------------------------
  // 7.6 submit_answers
  // -------------------------------------------------------------------------

  describe("submit_answers", () => {
    beforeEach(async () => {
      await data.forGame(FIXTURE_GAME_NAME).saveQuestion({
        id: "q1",
        category: "Science",
        statement: "Water boils at 100 degrees Celsius",
        isTrue: true,
        emojis: ["🔬"],
        createdAt: 1,
      });
    });

    it("batch saves multiple answers", async () => {
      const tool = createSubmitAnswersTool(data, fixtureGetGames);
      const result = await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
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
      const parsed = parseToolResult(result);

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
      const tool = createSubmitAnswersTool(data, fixtureGetGames);
      await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
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
      const tool = createSubmitAnswersTool(data, fixtureGetGames);

      // First submission
      await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
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
          game: FIXTURE_GAME_NAME,
          questionId: "q1",
          messageLink: "https://slack.com/archives/C123/p456",
          postedAt: 1000,
          answers: [{ userId: "U1", displayName: "Alice", answer: false }],
        },
        SESSION,
      );
      const parsed = parseToolResult(result);

      assert.equal(parsed.results[0].skipped, true);

      // Only one answer should be saved
      const answers = await data.forGame(FIXTURE_GAME_NAME).loadAnswers();
      const userAnswers = answers.filter((a) => a.userId === "U1");
      assert.equal(userAnswers.length, 1);
      assert.equal(userAnswers[0].answer, true); // Original answer unchanged
    });

    it("stamps question with postedAt/messageLink on first submission", async () => {
      const tool = createSubmitAnswersTool(data, fixtureGetGames);
      const messageLink = "https://slack.com/archives/C123/p456";
      const postedAt = 1000;

      await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
          questionId: "q1",
          messageLink,
          postedAt,
          answers: [{ userId: "U1", displayName: "Alice", answer: true }],
        },
        SESSION,
      );

      const questions = await data.forGame(FIXTURE_GAME_NAME).loadQuestions();
      const question = questions.find((q) => q.id === "q1");
      assert.equal(question?.messageLink, messageLink);
      assert.equal(question?.postedAt, postedAt);
    });

    it("does NOT overwrite postedAt on subsequent submissions", async () => {
      const tool = createSubmitAnswersTool(data, fixtureGetGames);
      const originalLink = "https://slack.com/archives/C123/p456";
      const originalPostedAt = 1000;

      // First submission
      await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
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
          game: FIXTURE_GAME_NAME,
          questionId: "q1",
          messageLink: "https://different.com",
          postedAt: 2000,
          answers: [{ userId: "U2", displayName: "Bob", answer: true }],
        },
        SESSION,
      );

      const questions = await data.forGame(FIXTURE_GAME_NAME).loadQuestions();
      const question = questions.find((q) => q.id === "q1");
      assert.equal(question?.messageLink, originalLink);
      assert.equal(question?.postedAt, originalPostedAt);
    });

    it("computes currentStreak correctly", async () => {
      // Add a second question
      await data.forGame(FIXTURE_GAME_NAME).saveQuestion({
        id: "q2",
        category: "History",
        statement: "Rome was founded in 753 BC",
        isTrue: true,
        emojis: ["🏛️"],
        createdAt: 2,
      });

      const tool = createSubmitAnswersTool(data, fixtureGetGames);

      // First answer correct
      const r1 = await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
          questionId: "q1",
          messageLink: "https://slack.com/archives/C123/p456",
          postedAt: 1000,
          answers: [{ userId: "U1", displayName: "Alice", answer: true }],
        },
        SESSION,
      );
      assert.equal(parseToolResult(r1).results[0].currentStreak, 1);

      // Second answer correct
      const r2 = await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
          questionId: "q2",
          messageLink: "https://slack.com/archives/C123/p789",
          postedAt: 2000,
          answers: [{ userId: "U1", displayName: "Alice", answer: true }],
        },
        SESSION,
      );
      assert.equal(parseToolResult(r2).results[0].currentStreak, 2);
    });

    it("resets currentStreak on incorrect answer", async () => {
      // Add a second question
      await data.forGame(FIXTURE_GAME_NAME).saveQuestion({
        id: "q2",
        category: "History",
        statement: "Rome was founded in 753 BC",
        isTrue: false, // False this time
        emojis: ["🏛️"],
        createdAt: 2,
      });

      const tool = createSubmitAnswersTool(data, fixtureGetGames);

      // First answer correct
      await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
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
          game: FIXTURE_GAME_NAME,
          questionId: "q2",
          messageLink: "https://slack.com/archives/C123/p789",
          postedAt: 2000,
          answers: [{ userId: "U1", displayName: "Alice", answer: true }],
        },
        SESSION,
      );
      assert.equal(parseToolResult(r2).results[0].currentStreak, 0);
    });
  });

  // -------------------------------------------------------------------------
  // 7.7 retrieve_scores
  // -------------------------------------------------------------------------

  describe("retrieve_scores", () => {
    it("returns empty leaderboard when no answers exist", async () => {
      const tool = createRetrieveScoresTool(data, fixtureGetGames);
      const result = await tool.handler(
        { game: FIXTURE_GAME_NAME, limit: undefined, sortBy: undefined, season: undefined },
        SESSION,
      );
      const parsed = parseToolResult(result);

      assert.deepEqual(parsed.leaderboard, []);
      assert.equal(parsed.totalPlayers, 0);
    });

    it("returns ranked leaderboard sorted by correctness", async () => {
      await data.saveUser({ userId: "U1", displayName: "Alice", joinedAt: 1 });
      await data.saveUser({ userId: "U2", displayName: "Bob", joinedAt: 2 });

      // Alice: 2 correct, 1 wrong
      await data.forGame(FIXTURE_GAME_NAME).saveAnswer({
        userId: "U1",
        questionId: "q1",
        answer: true,
        correct: true,
        timestamp: 1,
      });
      await data.forGame(FIXTURE_GAME_NAME).saveAnswer({
        userId: "U1",
        questionId: "q2",
        answer: true,
        correct: true,
        timestamp: 2,
      });
      await data.forGame(FIXTURE_GAME_NAME).saveAnswer({
        userId: "U1",
        questionId: "q3",
        answer: false,
        correct: false,
        timestamp: 3,
      });

      // Bob: 1 correct, 0 wrong
      await data.forGame(FIXTURE_GAME_NAME).saveAnswer({
        userId: "U2",
        questionId: "q1",
        answer: true,
        correct: true,
        timestamp: 4,
      });

      const tool = createRetrieveScoresTool(data, fixtureGetGames);
      const result = await tool.handler(
        { game: FIXTURE_GAME_NAME, limit: undefined, sortBy: undefined, season: undefined },
        SESSION,
      );
      const parsed = parseToolResult(result);

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
      await data.saveUser({
        userId: "U3",
        displayName: "Charlie",
        joinedAt: 3,
      });

      for (let i = 1; i <= 3; i++) {
        await data.forGame(FIXTURE_GAME_NAME).saveAnswer({
          userId: `U${i}`,
          questionId: "q1",
          answer: true,
          correct: true,
          timestamp: i,
        });
      }

      const tool = createRetrieveScoresTool(data, fixtureGetGames);
      const result = await tool.handler(
        { game: FIXTURE_GAME_NAME, limit: 2, sortBy: undefined, season: undefined },
        SESSION,
      );
      const parsed = parseToolResult(result);

      assert.equal(parsed.leaderboard.length, 2);
    });

    it("calculates accuracy percentage correctly", async () => {
      await data.saveUser({ userId: "U1", displayName: "Alice", joinedAt: 1 });

      // 3 correct, 1 wrong = 75% accuracy
      await data.forGame(FIXTURE_GAME_NAME).saveAnswer({
        userId: "U1",
        questionId: "q1",
        answer: true,
        correct: true,
        timestamp: 1,
      });
      await data.forGame(FIXTURE_GAME_NAME).saveAnswer({
        userId: "U1",
        questionId: "q2",
        answer: true,
        correct: true,
        timestamp: 2,
      });
      await data.forGame(FIXTURE_GAME_NAME).saveAnswer({
        userId: "U1",
        questionId: "q3",
        answer: true,
        correct: true,
        timestamp: 3,
      });
      await data.forGame(FIXTURE_GAME_NAME).saveAnswer({
        userId: "U1",
        questionId: "q4",
        answer: true,
        correct: false,
        timestamp: 4,
      });

      const tool = createRetrieveScoresTool(data, fixtureGetGames);
      const result = await tool.handler(
        { game: FIXTURE_GAME_NAME, limit: undefined, sortBy: undefined, season: undefined },
        SESSION,
      );
      const parsed = parseToolResult(result);

      assert.equal(parsed.leaderboard[0].accuracy, 75);
    });

    it("sorts by totalCorrect by default with accuracy as tiebreaker", async () => {
      await data.saveUser({ userId: "U1", displayName: "Alice", joinedAt: 1 });
      await data.saveUser({ userId: "U2", displayName: "Bob", joinedAt: 2 });

      // Alice: 2/3 = 67%
      await data.forGame(FIXTURE_GAME_NAME).saveAnswer({
        userId: "U1",
        questionId: "q1",
        answer: true,
        correct: true,
        timestamp: 1,
      });
      await data.forGame(FIXTURE_GAME_NAME).saveAnswer({
        userId: "U1",
        questionId: "q2",
        answer: true,
        correct: true,
        timestamp: 2,
      });
      await data.forGame(FIXTURE_GAME_NAME).saveAnswer({
        userId: "U1",
        questionId: "q3",
        answer: true,
        correct: false,
        timestamp: 3,
      });
      // Bob: 1/1 = 100%
      await data.forGame(FIXTURE_GAME_NAME).saveAnswer({
        userId: "U2",
        questionId: "q1",
        answer: true,
        correct: true,
        timestamp: 4,
      });

      const tool = createRetrieveScoresTool(data, fixtureGetGames);
      const result = await tool.handler(
        { game: FIXTURE_GAME_NAME, limit: undefined, sortBy: undefined, season: undefined },
        SESSION,
      );
      const parsed = parseToolResult(result);

      // Default sortBy is "totalCorrect" — Alice (2 wins) beats Bob (1 win) despite lower accuracy.
      assert.equal(parsed.leaderboard[0].displayName, "Alice");
      assert.equal(parsed.leaderboard[1].displayName, "Bob");
    });

    it("sorts by accuracy when sortBy is 'accuracy', with totalCorrect as tiebreaker", async () => {
      await data.saveUser({ userId: "U1", displayName: "Alice", joinedAt: 1 });
      await data.saveUser({ userId: "U2", displayName: "Bob", joinedAt: 2 });

      // Alice: 2/3 = 67%
      await data.forGame(FIXTURE_GAME_NAME).saveAnswer({
        userId: "U1",
        questionId: "q1",
        answer: true,
        correct: true,
        timestamp: 1,
      });
      await data.forGame(FIXTURE_GAME_NAME).saveAnswer({
        userId: "U1",
        questionId: "q2",
        answer: true,
        correct: true,
        timestamp: 2,
      });
      await data.forGame(FIXTURE_GAME_NAME).saveAnswer({
        userId: "U1",
        questionId: "q3",
        answer: true,
        correct: false,
        timestamp: 3,
      });
      // Bob: 1/1 = 100%
      await data.forGame(FIXTURE_GAME_NAME).saveAnswer({
        userId: "U2",
        questionId: "q1",
        answer: true,
        correct: true,
        timestamp: 4,
      });

      const tool = createRetrieveScoresTool(data, fixtureGetGames);
      const result = await tool.handler(
        { game: FIXTURE_GAME_NAME, limit: undefined, sortBy: "accuracy", season: undefined },
        SESSION,
      );
      const parsed = parseToolResult(result);

      // sortBy "accuracy" — Bob (100%) beats Alice (67%) despite fewer total wins.
      assert.equal(parsed.leaderboard[0].displayName, "Bob");
      assert.equal(parsed.leaderboard[1].displayName, "Alice");
    });

    it("breaks accuracy ties using totalCorrect", async () => {
      await data.saveUser({ userId: "U1", displayName: "Alice", joinedAt: 1 });
      await data.saveUser({ userId: "U2", displayName: "Bob", joinedAt: 2 });

      // Both 100% — Alice 5/5, Bob 1/1
      for (let i = 1; i <= 5; i++) {
        await data.forGame(FIXTURE_GAME_NAME).saveAnswer({
          userId: "U1",
          questionId: `q${i}`,
          answer: true,
          correct: true,
          timestamp: i,
        });
      }
      await data.forGame(FIXTURE_GAME_NAME).saveAnswer({
        userId: "U2",
        questionId: "q6",
        answer: true,
        correct: true,
        timestamp: 6,
      });

      const tool = createRetrieveScoresTool(data, fixtureGetGames);
      const result = await tool.handler(
        { game: FIXTURE_GAME_NAME, limit: undefined, sortBy: "accuracy", season: undefined },
        SESSION,
      );
      const parsed = parseToolResult(result);

      // Same accuracy → tiebreaker is totalCorrect, so Alice (5/5) outranks Bob (1/1).
      assert.equal(parsed.leaderboard[0].displayName, "Alice");
      assert.equal(parsed.leaderboard[1].displayName, "Bob");
    });

    it("rounds accuracy correctly", async () => {
      await data.saveUser({ userId: "U1", displayName: "Alice", joinedAt: 1 });

      // 1 correct, 2 wrong = 33.33...% accuracy, should round to 33
      await data.forGame(FIXTURE_GAME_NAME).saveAnswer({
        userId: "U1",
        questionId: "q1",
        answer: true,
        correct: true,
        timestamp: 1,
      });
      await data.forGame(FIXTURE_GAME_NAME).saveAnswer({
        userId: "U1",
        questionId: "q2",
        answer: true,
        correct: false,
        timestamp: 2,
      });
      await data.forGame(FIXTURE_GAME_NAME).saveAnswer({
        userId: "U1",
        questionId: "q3",
        answer: true,
        correct: false,
        timestamp: 3,
      });

      const tool = createRetrieveScoresTool(data, fixtureGetGames);
      const result = await tool.handler(
        { game: FIXTURE_GAME_NAME, limit: undefined, sortBy: undefined, season: undefined },
        SESSION,
      );
      const parsed = parseToolResult(result);

      const accuracy = parsed.leaderboard[0].accuracy;
      assert.ok(accuracy === 33 || accuracy === 34); // Allow for rounding variance
    });
  });
});
